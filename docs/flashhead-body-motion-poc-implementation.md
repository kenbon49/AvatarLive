# FlashHead 实时口型 + 真人肢体动作 PoC 实施记录

> **已停止作为当前动作主播方案（2026-07-21）**：本文记录的“FlashHead 生成完整脸 + 另一段真人身体视频 + 2D 对齐/羽化”存在不可消除的双运动源冲突。FlashHead 会自主改变头姿、脸形和下颌，真人底片也有自己的头部与下颌运动；张嘴和转头时因此会出现脸层相对头发、耳朵或颈部脱离。继续调整 affine、mask 或颜色匹配只能减轻接缝，不能从架构上同步两套运动。
>
> 当前实现已改为 `MuseTalk 1.5 + 真人动作视频当前帧`：只重建同一目标帧的嘴部/下半脸，mask 外的头姿、头发、脸轮廓、颈部、身体和手势保持原帧。FlashHead 回归纯头肩模式，不再参与真人身体合成；详情见 `docs/musetalk-action-avatar-implementation.md`。
>
> 本文其余内容按当时状态保留，作为已完成 PoC、测试数据和失败原因的历史记录。文中的“最终”“默认”“未再出现脸层脱离”等结论不代表当前推荐架构，也不代表旧方案在所有口型与姿态下已解决。

> 实施时间：2026-07-20 至 2026-07-21（Asia/Shanghai）
> 目标：保留 FlashHead 的实时脸部和口型生成，同时加入可控的半身动作，并通过 SynLive 现有 WebRTC 页面直接观看效果。
> 结论：PoC 已完成并部署到 `http://<主机>:8018/app/live`，默认选择“动作主播 PoC”。

## 1. 最终效果与边界

本次没有尝试让 FlashHead 凭一张头像生成不存在的手臂和身体。最终采用的方案是：

```text
文本 + action
  -> Azure TTS
  -> FlashHead 生成连续说话脸（512 x 512）
  -> 真人动作状态机选择身体底片（360 x 624）
  -> 6 点关键点相似变换 + 保留头发的软轮廓融合
  -> 固定 360 x 624、20 FPS
  -> 原有 PyAV / aiortc / WebRTC
  -> SynLive 浏览器预览
```

身体、头发、衣服、手和真实的动作轨迹来自同一位真人的预录视频；FlashHead 始终继续生成眼神、表情和口型。两层在 `AvatarVideoTrack.recv()` 的同一个媒体时钟中合成，因此动作不会替换口型，也不需要重建 WebRTC。

当前提供五种身体状态：

| 动作 ID | 前端名称 | 播放方式 | 用途 |
| --- | --- | --- | --- |
| `idle` | 待机 | ping-pong | 未说话时的自然微动 |
| `talk_subtle` | 自然讲解 | ping-pong | 普通播报的身体运动 |
| `welcome` | 欢迎 | once | 欢迎、你好等开场语 |
| `point` | 指向 | once | 讲参数、商品重点、引导观看 |
| `thank` | 感谢 | once | 感谢、下单、告别等语句 |

`auto` 不是一段素材，而是一个轻量规则：根据文本里的“欢迎 / 你好”“看这里 / 参数 / 这款”“谢谢 / 感谢 / 下单”等关键词选择一次性动作，其他文本回落到 `talk_subtle`。

## 2. 为什么选择这条路线

此前调研结论见 `docs/realtime-digital-human-social-platform-research.md`。对当前机器和业务目标，几种路线的实际取舍如下：

| 路线 | 优点 | 当前不采用为主线的原因 |
| --- | --- | --- |
| 单图全帧生成 | 理论上动作自由 | 单张图没有可靠身体几何；手、衣服和长时身份容易漂移；实时算力成本高 |
| LiveAct 全帧扩散 | 画质和自由度更高 | 当前是高质量出片链路，不适合作为低延迟交互默认模式 |
| 3D / MetaHuman | 动作可组合、可交互 | 资产、骨骼、动作重定向和渲染链路成本明显更高，观感也不同于真人视频 |
| 真人动作底片 + 实时脸 | 手、衣服和身体动作天然真实；3090 可实时 | 动作库是有限集合，需要为每位正式主播录制素材 |

LiveTalking 的自定义 `audiotype` 会在动作期间直接播放原始帧并抢占正常口型，不能原样复用。本次采用了更接近 OpenTalking 的“双层状态”：`speech_state` 和 `body_action` 正交，脸部生成永不中断。

参考实现：

- LiveTalking 动作配置与切换：<https://github.com/lipku/LiveTalking>
- OpenTalking 的真人底片循环与嘴部覆盖：<https://github.com/datascale-ai/opentalking>
- OpenTalking 的 live-broadcast 示例：<https://github.com/datascale-ai/opentalking/tree/main/examples/avatars/live-broadcast>

## 3. 素材选择与预处理

### 3.1 PoC 素材

源视频：

```text
/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4
```

源参数为 480 x 832、24 FPS、90 秒。它的优势是同一人物在同一机位内包含自然讲解、整理头发、双手动作和指向镜头等明显动作。参考头像也从同一视频抽取，避免把陌生头像贴到另一位演员身体上。

本次截取区间：

| 动作 | 源区间 | 目标帧数（20 FPS） | 说明 |
| --- | ---: | ---: | --- |
| `idle` | 14.0-17.0 秒 | 60 | 轻微头肩运动 |
| `talk_subtle` | 58.5-61.5 秒 | 60 | 头速低、首尾姿态接近的自然讲解 |
| `welcome` | 5.0-9.0 秒 | 80 | 整理头发，作为开场动作 |
| `point` | 41.8-44.4 秒 | 52 | 手指指向镜头，动作最明显 |
| `thank` | 35.7-37.2 秒 | 30 | 双手动作结束段，减少手掌遮脸 |

参考头像使用 28.0 秒的中性微笑帧，根据检测到的人脸中心裁为正方形并缩放到 512 x 512：

```text
public/assets/flashhead-avatars/motion-host.png
```

### 3.2 准备脚本

预处理脚本：

```text
scripts/prepare-flashhead-body-poc.py
```

它执行以下步骤：

1. 按 20 FPS 从源视频采样动作区间；
2. 使用 FlashHead 环境已有的 MediaPipe CPU 人脸检测器获得逐帧 `xyxy` 人脸框，以及双眼、鼻尖、嘴中心和双耳屏 6 点；
3. 对人脸框和 6 点关键点做 5 帧窗口中值平滑，降低检测抖动；检测失败帧会显式写入 invalid 标记；
4. 把身体帧缩放为 360 x 624 RGB；
5. 把参考头像、源脸框和源 6 点、身体帧、逐帧目标框及目标 6 点写入资产目录；
6. 生成 version 2 manifest，记录关键点 schema、安全切换、颜色匹配和羽化参数。

重新生成：

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/prepare-flashhead-body-poc.py
```

生成目录：

```text
public/assets/flashhead-body/motion-host/
  manifest.json
  idle.npz
  talk_subtle.npz
  welcome.npz
  point.npz
  thank.npz
```

压缩后的动作资产约 99 MiB。服务启动时会全部解码到内存，实时帧循环中不做视频解码；目标身体关键点全部离线计算。FlashHead 源脸使用 close-range FaceDetection 每两帧校正一次，中间帧走 LK 光流，以消除生成脸自身的轻微平移和转动。`.dockerignore` 排除了这些 NPZ，因为它们由宿主机 FlashHead 服务使用，不需要进入 Web 前端镜像。

### 3.3 授权边界

SoulX-LiveAct 仓库没有为视频里的人物单独给出可用于生产直播的肖像授权。本素材仅用于内部 PoC 和视觉判断，不能直接用于公开或商业直播。正式上线必须替换为已签署肖像和商用授权的演员素材；相关说明也写在：

```text
public/assets/flashhead-body/README.md
public/assets/flashhead-avatars/README.md
```

## 4. 身体合成模块

实现文件：

```text
apps/flashhead/body_compositor.py
apps/flashhead/face_tracking.py
apps/flashhead/__init__.py
tests/test_body_compositor.py
tests/test_face_tracking.py
```

### 4.1 启动阶段

`BodyCompositor(manifest_path)` 在构造时：

- 校验动作白名单和 manifest；
- 读取所有 NPZ；
- 校验 `uint8 RGB [N,H,W,3]`、`face_boxes [N,4]`，以及 version 2 的 `face_landmarks [N,6,2]` 和 valid 标记；
- 统一调整为 manifest 的固定输出尺寸；
- 将运行时帧和人脸框设为只读数组。

旧 manifest 继续走原来的 bbox resize 路径；version 2 在运行时增加轻量源脸跟踪、脸部 ROI 仿射和 alpha blend。关键点暂时不可用或拟合失败时，version 2 会改用 bbox 仿射，但仍保持同一套脸形 mask 和颜色融合；只有 OpenCV warp 本身异常时才退到旧 resize 路径，且不会中断 WebRTC。`/health` 中的 `tracking_enabled` 和累计 `fallback_frames` 可用于发现跟踪失效或降级。

### 4.2 状态机

```text
IDLE
  └─ speech_start ─> SPEAK_GESTURE 或 SPEAK_TALK

SPEAK_GESTURE
  ├─ once 播完且仍在说话 ─> SPEAK_TALK
  ├─ speech_end / interrupt ─> IDLE
  └─ 新一次性动作 ─> 新动作（或按请求排队）

SPEAK_TALK
  ├─ speech_end / interrupt ─> IDLE
  └─ 语义动作 ─> SPEAK_GESTURE

MANUAL_GESTURE
  ├─ once 播完 ─> IDLE
  └─ interrupt ─> IDLE
```

`idle` 和 `talk_subtle` 使用不重复端点的 ping-pong 索引。一次性动作结束后，如果语音仍在播放则回到 `talk_subtle`，否则回到 `idle`。

每次动作请求都会获得单调递增的 `generation`。语音打断、人物切换、WebRTC 重连和服务关闭时会使旧 generation 失效，从而避免上一句的异步清理误伤下一句动作。

### 4.3 脸身融合

manifest 同时记录：

- `source_face_box` 和 `source_face_landmarks`：参考头像中的回退框与 6 点；
- 每帧 `face_boxes`、`face_landmarks` 和 `face_landmarks_valid`：真人身体底片的目标几何；
- `feather_ratio`：脸形软轮廓的羽化宽度；
- `transition_mode: cut`：避免两个位置不同的完整头部做像素 crossfade；
- `color_match_strength`：每次动作切换后计算一次边缘局部颜色补偿。

每一帧的处理顺序：

1. 每两帧以 close-range FaceDetection 重新取得源脸 6 点，中间帧用前后向 LK 光流跟踪；光流有前后向误差、单帧尺度/roll/位移和最长 stale 帧限制；
2. 以双眼、鼻尖和耳屏估计 source -> target 的 similarity transform，嘴中心不参与拟合；检测和光流明显冲突时直接采用新检测，大 yaw 无法通过五个稳定点拟合时使用双眼相似变换；
3. 只在目标脸 ROI 内做 `warpAffine`，而不是拉伸整个 bbox；
4. 使用上边界低于发际线的脸形软 mask，保留底片的帽子、刘海、耳朵和颈部；
5. 局部匹配边缘颜色后做 alpha blend；检测或矩阵异常时用动态框/固定框生成 bbox 仿射，继续使用相同的多边形 mask，避免在两套视觉路径间闪变；
6. 返回连续、固定尺寸的 RGB 帧。

mask 只替换中央脸部，保留真人底片的帽子、头发、耳朵、颈部、手和衣服。`talk_subtle` 也从原来的 19-24 秒替换为 58.5-61.5 秒：新片段的头中心波动约减少 56%，头姿变化约减少 37%，且 ping-pong 两端速度更接近，降低循环反向时的跳动。

## 5. FlashHead 服务接入

现有 FlashHead 运行服务仍位于：

```text
/data/llm_model/cyberverse/flashhead_server.py
```

这是工作区外的现有部署文件。本次只在它的帧出口和控制 API 做小范围接入，主体合成逻辑保留在 SynLive 仓库模块中。

### 5.1 合成点

合成发生在 `AvatarVideoTrack.recv()`：选出 speech 或 idle FlashHead 帧之后、调用 `av.VideoFrame.from_ndarray()` 之前。

选择这里的原因：

- 讲话和待机统一走一条路径；
- 复用原本的 20 FPS 单一时钟；
- 不影响 GPU 的单线程推理 executor；
- 不增加新的 WebRTC track 或浏览器同步逻辑。

MediaPipe 检测、LK 光流、ROI warp 和 blend 由独立的单线程 compositor executor 执行；`AvatarVideoTrack.recv()` 异步等待结果，因此约 7-11 ms 的 CPU 合成不会占住 asyncio 事件循环，也不会阻塞每 20 ms 调度一次的音频轨。提交任务时会把当前 `avatar_id` 与帧一起快照，避免人物切换期间旧脸误走新人物分支；服务退出时先等待 compositor worker，再显式关闭 MediaPipe detector。GPU 推理仍使用原有的独立 executor。

身体 profile 输出固定为 360 x 624。切换到原来的纯头像时，会把 512 x 512 头像居中放入同尺寸竖版画布，避免 WebRTC 中途改变编码分辨率。

### 5.2 语音与动作同步

动作不是收到 `/human` 请求就立刻播放。服务先完成 TTS 和首个 FlashHead chunk，随后在打开音视频共同播放门之前调用 `request_action()`。因此动作与真实口型起播时间一致，不会在 2 秒 TTS 等待期间提前演完。

语音完成或被打断后，服务用该语音持有的 generation 清理动作。若新一句已经开始，旧 generation 的清理会被忽略。

### 5.3 API

查询动作：

```http
GET /actions
```

触发不带声音的一次性动作：

```http
POST /action
Content-Type: application/json

{
  "action": "point",
  "interrupt": true
}
```

播报时指定动作：

```http
POST /human
Content-Type: application/json

{
  "type": "echo",
  "text": "请看这里，这款产品的核心参数已经整理好了。",
  "action": "point",
  "interrupt": true
}
```

`/health` 新增 `body`、`body_enabled`、`body_profile_avatar`，并把输出分辨率报告为 360 x 624；`body.state` 还包含 `tracking_enabled` 和累计 `fallback_frames`。

### 5.4 启动脚本

`scripts/run-flashhead-demo.sh` 新增：

```text
SYNLIVE_ROOT
FLASHHEAD_BODY_MANIFEST
FLASHHEAD_BODY_AVATAR
```

启动前会验证身体 manifest；缺失时给出预处理命令，而不是启动后静默退化。

当前由用户级 systemd 服务常驻：

```bash
systemctl --user restart synlive-flashhead.service
systemctl --user status synlive-flashhead.service
curl -fsS http://127.0.0.1:8030/health | jq
```

## 6. SynLive 前端接入

主要修改：

```text
src/lib/api.ts
src/components/live-console.tsx
src/app/globals.css
```

页面新增：

- “动作主播 PoC”人物卡，并设为默认；
- “肢体动作编排”面板；
- 自动、自然讲解、欢迎、指向、感谢选择；
- 一次性动作的“单独预览”按钮；
- “录制样片”入口；
- 身体 profile 未选中时的禁用和提示；
- 已连接时“实时口型 + 真人肢体”的状态文案；
- 桌面和移动端响应式布局。

前端 API 增加：

```text
getFlashHeadActions()
triggerFlashHeadAction(action)
speakFlashHead(text, interrupt, action)
```

用户实际入口 `:8018` 位于 Caddy 和生产 Web 容器后。完成源码修改后使用以下命令重建 Web 镜像：

```bash
docker compose --env-file .env -f infra/docker-compose.yml \
  up -d --build --no-deps web
```

必须使用仓库根目录的 `.env`，以复用当前内网 Harbor 的 `REGISTRY`；不带它时，本机 Docker 的公网镜像 DNS 会失败。

## 7. 可直接观看的样片

真实 WebRTC 录制脚本：

```text
scripts/record-flashhead-body-poc.py
```

运行：

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/record-flashhead-body-poc.py
```

当前样片：

```text
public/demos/flashhead-body-poc.mp4
```

页面地址：

```text
http://<主机>:8018/demos/flashhead-body-poc.mp4
```

样片内容使用 `point`，先记录待机画面，随后播报“请看这里，这款产品的核心参数和优惠信息都已经为你整理好了”，一次性指向动作播完后回落到自然讲解。

录制文件参数：

| 项目 | 结果 |
| --- | --- |
| 封装 | MP4 |
| 视频 | H.264，360 x 624 |
| 音频 | AAC |
| 时长 | 12.10 秒 |
| 大小 | 约 893 KiB |

## 8. 验证结果

### 8.1 单元和静态检查

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  -m unittest -v tests.test_body_compositor tests.test_face_tracking

corepack pnpm typecheck
bash -n scripts/run-flashhead-demo.sh
git diff --check
```

结果：

- `BodyCompositor` 和 face tracking 共 22 项测试全部通过；
- 除原有状态机外，覆盖安全切换、已知旋转/缩放/平移的关键点重投影、双眼 yaw 回退、异常 roll 拒绝、LK 光流、检测 stale 上限、跨流大跳变、检测异常回退、source/target 越界 metadata 拒绝、landmark warp、双重 warp 失败只计一次、v2 bbox 降级仍保持 polygon warp，以及 detector 资源释放；
- 真实素材连续合成 1000 帧：平均 7.55 ms、p95 10.41 ms、p99 10.89 ms、最大 12.11 ms，低于 20 FPS 的 50 ms 帧预算；1000 帧后 `fallback_frames=0`；
- 当前五个动作的离线目标几何共 282/282 帧通过变换校验，其中 236 帧使用五点 similarity，46 帧在较大 yaw 下使用双眼 similarity，reject 为 0；
- TypeScript 类型检查通过；
- Shell/Python 语法和 diff whitespace 检查通过；
- Docker 内 `next build` 编译、类型检查和 17 个静态页面生成全部通过。

### 8.2 浏览器端到端验收

验收脚本：

```text
scripts/verify-live-flashhead.cjs
```

运行：

```bash
NODE_PATH=/tmp/synlive-pw-run/node_modules \
PLAYWRIGHT_CHROMIUM_PATH=/home/super/.cache/ms-playwright/chromium-1187/chrome-linux/chrome \
node scripts/verify-live-flashhead.cjs
```

本轮结果：

| 检查项 | 结果 |
| --- | --- |
| 页面 | `http://127.0.0.1:8018/app/live` 正常 |
| WebRTC 视频 | 360 x 624，浏览器实际解码 |
| 帧率 | 1.6 秒前进 32 帧，接近 20 FPS |
| 动作 API | 六个 ID 完整，`point` 单独预览有可见变化 |
| 人物切换 | 6 个人物逐一切换，不重建 PeerConnection |
| 音频 | inbound RTP 收到 2353 包 |
| 视频 | inbound RTP 解码 939 帧，统计 20 FPS |
| 固定播报音画偏差 | 8.4 ms |
| Q&A 播报音画偏差 | 9.3 ms |
| 逐人物音画偏差 | 9.4-39.7 ms |
| 浏览器错误 | 0 |
| HTTP 错误 | 0 |
| 移动端 | 390 x 844 页面正常 |

最近一次真实样片播报：

| 指标 | 结果 |
| --- | ---: |
| TTS | 3557.1 ms |
| 首个 FlashHead chunk | 754.2 ms |
| 音频时长 | 6.188 秒 |
| 生成帧数 | 124 |
| 首视频 | 4430.7 ms |
| 首音频 | 4421.4 ms |
| 音画起播偏差 | 9.3 ms |
| 请求到播放完成 | 10601.5 ms |

对最终样片 242 帧逐帧重新做人脸检测，242/242 全部成功；检测脸中心相邻帧位移中位数为 2.20 px、p95 为 6.65 px、最大 12.86 px。人工检查 `point -> talk_subtle` 切换、张嘴、眨眼、头部轻转和手指经过脸旁的帧，未再出现旧样片中的椭圆双脸、脸层脱离头部或 250 ms 双头重影。完整浏览器回归结束后服务仍报告 `tracking_enabled=true`、`fallback_frames=0`。

这里仍需区分“20 FPS 实时播放”和“首响延迟”：稳态输出为 20 FPS，但新文本需要约 2-3 秒完成 TTS 与首个生成 chunk 后才开始播放。本次没有优化 TTS 或 FlashHead 首响，只保证动作层没有额外增加模型推理延迟。

## 9. 当前限制与下一步

1. **素材授权**：当前演员视频只能做内部 PoC，正式使用前必须重录授权素材。
2. **动作不是无限生成**：`welcome / point / thank` 是有限状态机，不是 LLM 逐帧生成任意动作。
3. **前景遮挡**：当前脸形 mask 已避开大部分头发和手指，但没有语义级手部 occlusion；如果手掌完整遮住嘴或脸仍会发生层级错误。正式素材应避开遮脸，或离线增加逐帧前景 mask。
4. **大幅转头**：6 点 similarity 已能校正平移、统一缩放和 roll，但不能重建大 yaw/pitch 下的三维脸形；动作素材仍应保持近正脸。生产级大姿态需要 FaceMesh/稠密形变或全帧生成。
5. **动作切点**：version 2 使用 hard cut 消除了双头重影，但姿态差异过大时仍可能出现一帧跳变。生产动作库应标注中性姿态和 `safe_cut_frames`，或使用头姿对齐后的转场。
6. **内存**：动作帧启动时全量预载，额外占用约 200 MiB 级 RAM；动作库扩大后应改为分 profile 缓存或后台预取。
7. **单会话**：当前 FlashHead 服务仍是单 WebRTC 会话，新 `/offer` 会关闭旧连接；多观众应通过 SFU/转推分发，而不是每个浏览器独占渲染服务。
8. **首响**：下一轮性能工作应优先流式 TTS 和更短首 chunk，而不是只提高稳态 FPS。
9. **MediaPipe 依赖**：当前 FaceDetection 可稳定工作，但 Cyberverse 环境的 MediaPipe 与 protobuf/numpy 版本约束不一致；FaceMesh 暂不可用，应在独立预处理环境锁定兼容版本后再升级稠密关键点。

建议下一阶段按以下顺序推进：

1. 找一位授权演员，在固定机位录制 `idle / talk / welcome / point_product / thank / thinking`；
2. 为动作片段增加安全切点和前景遮挡 mask，并补录嘴闭合、头部更静止的 talk 底片；
3. 把 LLM 输出扩展为 `{text, emotion, action}`，并在业务层做动作白名单与冷却时间；
4. 做 30 分钟连续直播、频繁打断和动作切换压力测试；
5. 若业务必须拿商品、走动或自由空间交互，再评估 MetaHuman/3D 动作状态机，而不是继续扩张 2D 动作库。
