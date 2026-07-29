# MuseTalk 动作速度与多人物热切换实施记录

> 初次实施与验收日期：2026-07-21（Asia/Shanghai）
>
> 最近进展日期：2026-07-22（Asia/Shanghai）
>
> 正式入口：`http://10.2.42.21:8018/app/live`
>
> 当前结论：MuseTalk 音视频继续输出 25 FPS，两个角色的全部动作已恢复为 `1.0x` 正常速度；7 月 21 日重截取的稳定待机片段继续保留。正常速度是针对“身体动作被放慢”和嘴部图层感的先行修复，jaw mask 仍保持 `upper_boundary_ratio=0.55`，后续再单独进行 `0.55` 与 `0.60` A/B，避免把速度与融合边界两个变量混在一次调整中。第二个人物和不重连 WebRTC 的热切换继续保留。
>
> 资产边界：两个人物均来自 SoulX-LiveAct 本地示例视频，只能用于内部 PoC。源演员在部分片段中本来就在说话，且没有独立的生产肖像/表演授权，不能直接用于公开或商业直播。

## 1. 2026-07-21 问题与目标（历史）

本节和第 2 节保留 2026-07-21 初次调速时的问题判断与方案选择。2026-07-22 的视觉复核改变了“应当慢放”的结论，但不撤销稳定待机片段、独立 `playback_rate` 能力和多人物热切换实现。

上一轮已把“FlashHead 完整脸贴到真人身体”改成了 MuseTalk 的同帧嘴部重建，脸层相对头发、耳朵和颈部的漂离明显减轻。本轮仍有四个直接影响使用和观感的问题：

1. 身体素材每输出一帧就前进一个源帧，25 FPS 下动作显得急促；
2. 原 `motion-host` 待机片段本身头部位移较大，即使单纯降速，人物仍会在静默时持续大幅晃动；
3. 服务只有一个固定人物，前端无法在直播过程中试用其他形象；
4. 人物切换不能以重建模型或 WebRTC 为代价，否则会出现长时间等待、黑屏和音视频重协商。

本轮目标因此是：

- WebRTC、音频特征和口型输出继续保持 25 FPS，不牺牲音画同步；
- 身体动作独立减速，静默待机同时降低速度和位移幅度；
- 提供两个可切换人物，切换时不重载 MuseTalk 模型、不创建新的 PeerConnection；
- 旧播报、旧预览和旧 GPU 任务不能污染新人物的 generation 状态；
- 完成后覆盖单元测试、生产构建、真实 TTS/MuseTalk/WebRTC 和移动端验证。

## 2. 2026-07-21 原因定位与方案选择（历史）

### 2.1 动作为什么快

动作速度不是 MuseTalk 推理吞吐造成的。原 planner 在每个 25 FPS 输出 tick 都把身体素材索引推进一帧：

```text
25 FPS 媒体时钟
  -> 每个 tick 取下一个身体源帧
  -> MuseTalk 按当前目标帧重建嘴部
  -> WebRTC 仍按 25 FPS 发出
```

因此源视频中的正常动作被原速、连续、无限 ping-pong 播放。降低整个视频 FPS 会同时破坏 Whisper 音频特征采样、口型节奏、RTP 时间戳和浏览器播放平滑度，不适合作为解决方案。

本轮改为给每个动作增加独立 `playback_rate`。媒体轨仍输出 25 FPS，但身体游标只按分数相位推进：

```text
输出帧：       0 1 2 3 4 5 6 7 ...
0.5x 源索引：  0 0 1 1 2 2 3 3 ...
0.6x 源索引：  0 0 1 1 2 3 3 4 ...
```

实现使用 `Fraction` 累积相位，避免长时间运行时浮点误差造成节奏漂移。`playback_rate` 被限制在 `0 < rate <= 1`，旧 manifest 未配置时继续按 `1.0` 播放。

### 2.2 为什么不能只减速旧 idle

旧 `motion-host` idle 有 75 帧、源时长 3 秒，人脸框中心运动范围约为 `38.2 x 20.3 px`。减速只能延长完成这段轨迹所需的时间，不能缩小人物最终走过的距离。

所以实际采用了两层处理：

1. 从源视频中重新选择更稳定的 14.4-15.8 秒片段，把 idle 缩为 35 帧；
2. 再将身体游标设为 0.35x，形成约 7.80 秒的完整 ping-pong 周期。

新 idle 人脸中心运动范围为 `16.0 x 14.5 px`，首尾中心距离约 `3.95 px`。相对旧片段，水平范围降低约 58%，垂直范围降低约 29%。这同时解决了“晃动幅度大”和“晃动速度快”，而不是只把大幅动作慢放。

### 2.3 为什么使用本地人物目录

客户端只能提交 catalog 中的安全人物 ID，不能提交 manifest、NPZ 或 cache 路径。这样可以避免路径穿越、任意文件读取以及客户端把服务切到未经校验的资产。

人物 catalog 位于：

```text
public/assets/musetalk-body/manifest.json
```

后端启动时一次性校验所有人物，并要求每个人物具有完全相同的输出分辨率和 FPS。当前均为 `360 x 624 @ 25 FPS`，所以 RTP track 不需要重新协商。

## 3. 动作资产调整结果

### 3.1 2026-07-21 慢速实验记录

以下两张表保留 2026-07-21 初次验收时的慢速参数和有效时长，用于记录当时“降低身体游标速度”的实验结论；它们不再代表当前生产配置。

动作范围由两个独立配置文件记录：

```text
scripts/musetalk-motion-host-ranges.json
scripts/musetalk-blue-host-ranges.json
```

#### `motion-host`（暖色女主播）

源视频：

```text
/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4
```

| 动作 | 源区间（秒） | 源帧数 | 模式 | 身体速率 | 25 FPS 下有效时长 |
| --- | ---: | ---: | --- | ---: | ---: |
| `idle` | 14.4-15.8 | 35 | ping-pong | 0.35x | 7.80 s/周期 |
| `talk_subtle` | 58.5-61.5 | 75 | ping-pong | 0.60x | 9.88 s/周期 |
| `welcome` | 5.0-9.0 | 100 | once | 0.70x | 5.72 s |
| `point` | 41.8-44.4 | 65 | once | 0.70x | 3.72 s |
| `thank` | 35.7-37.2 | 38 | once | 0.70x | 2.20 s |

总计 313 个唯一目标帧，资产目录约 110 MiB。idle 人脸中心范围为 `16.013 x 14.486 px`，相邻源帧平均中心位移约 `1.656 px`。

#### `blue-host`（蓝衣男主播）

源视频：

```text
/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/2.mp4
```

| 动作 | 源区间（秒） | 源帧数 | 模式 | 身体速率 | 25 FPS 下有效时长 |
| --- | ---: | ---: | --- | ---: | ---: |
| `idle` | 85.6-87.0 | 35 | ping-pong | 0.30x | 9.08 s/周期 |
| `talk_subtle` | 78.5-80.1 | 40 | ping-pong | 0.55x | 5.68 s/周期 |
| `welcome` | 28.8-31.2 | 60 | once | 0.65x | 3.72 s |
| `point` | 21.4-22.8 | 35 | once | 0.65x | 2.16 s |
| `thank` | 115.0-117.0 | 50 | once | 0.65x | 3.08 s |

总计 220 个唯一目标帧，资产目录约 80 MiB。idle 人脸中心范围为 `6.626 x 4.723 px`，相邻源帧平均中心位移约 `0.715 px`，比 `motion-host` 更稳定。

上述“有效时长”按 2026-07-21 配置下 planner 的源帧推进计算：ping-pong 使用 `2N - 2` 个源步进，once 使用 `N` 个源步进，再除以 `playback_rate` 并向上取整为输出帧。无声动作预览也改为使用同一精确预算，避免较快动作结束后多带 idle 尾帧，并防止未来配置低于 0.5x 时提前截断。

### 3.2 2026-07-22 恢复正常速度

视觉复核发现，低倍速会让同一身体源帧连续保持 2-4 个输出 tick，而 MuseTalk 仍每 40 ms 重建一次嘴部。身体和底片脸部近似静止、jaw 区域纹理却持续变化时，嘴部更容易呈现“单独一层在变化”的观感；动作本身也明显慢于源视频，显得不自然。因此当前生产 manifest 与两份 ranges 配置已将十个动作统一恢复为 `playback_rate=1.0`：

| 人物 | `idle` | `talk_subtle` | `welcome` | `point` | `thank` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `motion-host` | 1.0x | 1.0x | 1.0x | 1.0x | 1.0x |
| `blue-host` | 1.0x | 1.0x | 1.0x | 1.0x | 1.0x |

恢复正常速度后的动作时长如下；ping-pong 周期仍按 `2N - 2` 帧计算，once 动作按 `N` 帧计算：

| 人物 | `idle` 周期 | `talk_subtle` 周期 | `welcome` | `point` | `thank` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `motion-host` | 2.72 s | 5.92 s | 4.00 s | 2.60 s | 1.52 s |
| `blue-host` | 2.72 s | 3.12 s | 2.40 s | 1.40 s | 2.00 s |

本次只调整播放速率，继续复用 7 月 21 日重截取的稳定片段和现有 NPZ，不重新抽帧，也不同时改变融合策略。`jaw` mask 当前仍使用 `upper_boundary_ratio=0.55`；如果正常速度下仍能看到嘴部图层感，下一步将单独对比 `0.55` 与 `0.60`，再依据边界暴露和融合稳定性决定是否调整。

### 3.3 重新生成命令

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/prepare-flashhead-body-poc.py \
  --source /data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4 \
  --fps 25 \
  --profile motion-host \
  --ranges-json scripts/musetalk-motion-host-ranges.json \
  --output-root public/assets/musetalk-body/motion-host \
  --avatar-output public/assets/musetalk-body/motion-host/reference.png

/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/prepare-flashhead-body-poc.py \
  --source /data/llm_model/SoulX-LiveAct-models/LiveAct/assets/2.mp4 \
  --fps 25 \
  --profile blue-host \
  --ranges-json scripts/musetalk-blue-host-ranges.json \
  --output-root public/assets/musetalk-body/blue-host \
  --avatar-output public/assets/musetalk-body/blue-host/reference.png
```

重新生成后会改变 cache key；下次启动自动重建该人物的 MuseTalk latent/mask 缓存。

## 4. 多人物运行时架构

### 4.1 单模型、多 runtime、多 cache

服务不会为每个人物各加载一套 MuseTalk、Whisper 和 VAE 模型。启动顺序是：

```text
avatar catalog
  -> 为每个人物加载 BodyActionRuntime
  -> 校验 profile id、360 x 624 和 25 FPS
  -> 只创建一个 MuseTalkEngine
  -> motion-host 使用独立 cache 预处理
  -> blue-host 使用独立 cache 预处理
  -> 合并 prepared/neutral 索引
  -> 预热默认人物
  -> ready
```

缓存身份从原来的 `(action, frame_index)` 扩展为：

```text
(profile_id, action, frame_index)
```

这样两个人物都可以有 `idle:0`，但 latent、mask、neutral frame 不会互相覆盖。安装一个 profile 的 prepared/neutral 数据时只替换同 profile 的旧键，其他人物保持不变；旧单人物 cache 格式仍可读取。

当前 cache：

```text
/data/MuseTalk/results/synlive-cache/motion-host-v15.npz  # 约 5.5 MiB
/data/MuseTalk/results/synlive-cache/blue-host-v15.npz    # 约 4.1 MiB
```

### 4.2 不重连的热切换

切换流程如下：

```text
POST /avatar
  -> 获取与 /offer、/action、/human 共用的控制锁
  -> 中断当前播报并清理音频、视频和预览队列
  -> 原子替换 active runtime/avatar id
  -> 在现有 AvatarVideoTrack 上立即发布新人 neutral idle
  -> 保留原 RTCPeerConnection、音轨和视频轨
```

说话任务在开始时保存 `runtime`、`engine` 和 `avatar_id` 快照。首批视频生成后还会检查：

- cancel event 是否已触发；
- 当前人物是否仍与任务人物相同；
- generation 是否仍属于原 runtime。

旧 CUDA executor 即使不能立刻停止，其 `finally` 也只会结束旧 runtime 的 generation，不能误清理新人物恰好同号的 generation。预览同样保存 owner runtime，切换后不会在新人 runtime 上调用旧预览的 `finish()`。

### 4.3 API

```http
GET /avatars
```

返回固定人物列表、当前人物、切换状态和配置/运行错误。

```http
POST /avatar
Content-Type: application/json

{
  "avatar_id": "blue-host"
}
```

未知 ID 返回 404，非字符串或空 ID 返回 400。客户端不能通过该接口指定文件路径。

`GET /actions` 的 `profile_avatar` 会随人物切换，前端只有在它与 `active_avatar` 一致时才重新启用动作按钮。

## 5. 前端交互

MuseTalk 模式新增了与现有视觉语言一致的人物选择区：

- 自动读取 `/musetalk-api/avatars`；
- 展示人物缩略图、当前人物、pending、服务配置错误和重试状态；
- 切换期间禁用实时播报、问答、动作选择、动作预览和停止按钮；
- 切换结束后重新读取动作状态；
- 通过 request generation 丢弃切模式后的过期响应；
- 后端若返回 `switching: true`，前端按 1.2 秒间隔轻量轮询直到完成；
- 人物切换 handler 不关闭、不清空、不创建 `pcRef`。

API 层会严格校验人物 ID slug、重复 ID、当前 ID、错误字段类型，以及 `multi_avatar_enabled` 是否与列表数量一致，避免异常响应进入 UI 状态。

主要前端文件：

```text
src/lib/api.ts
src/components/live-console.tsx
scripts/verify-live-musetalk.cjs
```

## 6. 主要代码与资产变更

| 文件 | 本轮职责 |
| --- | --- |
| `apps/musetalk/action_runtime.py` | profile 命名空间、分数倍速游标、精确预览帧预算 |
| `apps/musetalk/avatar_catalog.py` | 固定本地人物目录、安全 ID/路径和默认人物校验 |
| `apps/musetalk/inference.py` | `(profile, action, index)` 缓存键、每人物 cache、prepared/neutral 合并 |
| `apps/musetalk/server.py` | 双人物初始化、`/avatars`、`/avatar`、原子热切换和旧任务隔离 |
| `scripts/prepare-flashhead-body-poc.py` | `--profile`、`--ranges-json` 和每动作 `playback_rate` |
| `scripts/run-musetalk-demo.sh` | catalog 环境变量与启动前检查 |
| `src/lib/api.ts` | 人物响应校验、查询和切换请求 |
| `src/components/live-console.tsx` | 人物选择器、切换状态和交互禁用规则 |
| `public/assets/musetalk-body/manifest.json` | `motion-host`、`blue-host` 固定 catalog |
| `public/assets/musetalk-body/*/manifest.json` | 各人物动作范围、帧数、模式和倍速 |
| `.dockerignore` | 排除仅宿主机服务使用的 MuseTalk NPZ，Web 构建上下文降至约 892 KiB |
| `tests/test_musetalk_*.py` | runtime、catalog、cache、API、媒体轨和并发回归测试 |

## 7. 测试与真实验收

### 7.1 自动化与静态检查

执行：

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  -m unittest discover -s tests -v

/home/super/miniconda3/envs/cyberverse/bin/python \
  -m compileall -q apps/musetalk tests

corepack pnpm run typecheck
corepack pnpm run build
node --check scripts/verify-live-musetalk.cjs
bash -n scripts/run-musetalk-demo.sh
git diff --check
```

结果：

- Python：68 tests，全部通过；
- TypeScript：通过；
- Next.js 16.2.10 生产构建：17 个静态页面全部生成；
- Python compile、Node 语法、shell 语法和 whitespace 检查：全部通过；
- 独立并发场景验证：旧人物正在 GPU render 时切换，旧任务取消且新人 generation、video/audio track 和 peer 对象不受影响。

### 7.2 启动与缓存

首次安装两个人物并重建 cache：

```text
motion-host 313 帧预处理
blue-host   220 帧预处理
neutral     313 + 220 帧预生成
总初始化    87,233.1 ms
```

已有 cache 后的最终重启：

```text
加载 motion-host cache  313 帧
加载 blue-host cache    220 帧
总初始化                 40,440.2 ms
ready 日志               avatars=2 frames=533
```

最终服务进程 RSS 约 `2.82 GiB`。两个 profile 共享一套模型；增加第二个人物没有再创建第二个 `MuseTalkEngine`。GPU 2 同时有其他常驻进程，因此本轮不把整卡 `nvidia-smi` 占用误报为 MuseTalk 独占显存。

### 7.3 浏览器 E2E

验证脚本：

```bash
NODE_PATH=/tmp/synlive-browser-check/node_modules \
PLAYWRIGHT_CHROMIUM_PATH=/home/super/.cache/ms-playwright/chromium-1187/chrome-linux/chrome \
SYNLIVE_TEST_URL=http://127.0.0.1:8018/app/live \
node scripts/verify-live-musetalk.cjs
```

正式 `:8018` 最终结果：

| 项目 | 结果 |
| --- | ---: |
| catalog 与 UI 人物 | `motion-host`、`blue-host` 均存在 |
| 人物画面签名距离 | 64.22，阈值为 3 |
| PeerConnection | 切换前后 created=1、live=1、same=true |
| 蓝衣人物播报 | `welcome`，115 帧，音频 4.625 s |
| TTS | 2,660.6 ms |
| 音频特征 | 21.9 ms |
| 首视频 batch | 272.5 ms |
| 总视频生成 | 4,005.3 ms |
| 首媒体就绪 | 2,955.1 ms |
| 音视频首帧偏差 | 20.0 ms |
| 请求总时长 | 7,696.0 ms |
| 浏览器视频统计 | 398 帧，约 26 FPS |
| stop 回落 | active=null、queued=0、idle、speaking=false |
| 桌面 console/page/HTTP 错误 | 0 |
| 390 px 移动端横向溢出 | 0 px |

测试结束后自动恢复 `motion-host`，服务处于 `idle`、`switching=false`，没有残留 PeerConnection。

## 8. 部署结果

后端使用最新代码和两份 cache 运行在宿主机 `:8031`。Web 镜像通过内网 registry 前缀构建并重新部署：

```bash
REGISTRY=harbor-develop.zuzuche.net/dockerhub/ \
  docker compose -f infra/docker-compose.yml build web

REGISTRY=harbor-develop.zuzuche.net/dockerhub/ \
  docker compose -f infra/docker-compose.yml up -d --no-deps web
```

2026-07-21 初次验收 Web 镜像：

```text
sha256:29181ff1f9dc1449b67f260811bff8156c57080c13621c666935626362c3f90d
```

正式页面与同源 API 均返回 200，`/musetalk-api/avatars` 返回两个已安装人物。保留的 Web 回滚镜像为：

```text
synlive-web:pre-musetalk-20260721
sha256:011a33c86ce8511260bebffc21899276595fad8dcca946a8718c6ac5157b85fb
```

### 8.1 2026-07-22 常驻与错误处理修复

初次验收时 MuseTalk 后端由临时交互进程启动，仓库内的 user systemd unit 尚未链接和启用。临时会话结束后 `:8031` 无进程监听，Next 同源代理返回纯文本 `500 Internal Server Error`；人物响应解析器又在检查 HTTP 状态前直接调用 `res.json()`，最终把服务离线误报为 `Unexpected token 'I'`。

本次修复包括：

- 人物和动作响应先判断 HTTP 状态，非 JSON 错误体回落为 `HTTP 500`；
- `synlive-musetalk.service` 改为 `Restart=always`，正式链接并启用；
- 为 `super` 用户启用 linger，确保退出登录后 user service 仍常驻；
- 重建并部署 Web 镜像 `sha256:df3cea816781f1ce530865f482515734e34e29b0502dc0fe1e8dff4813a8539a`。

最终运行状态：

```text
systemd       enabled / active / running
user linger   yes
MuseTalk      ready, 360 x 624 @ 25 FPS
avatars       motion-host, blue-host
```

正式环境重新完成 Playwright 验收：纯文本 500 回归场景显示 `HTTP 500`，人物热切换保持同一个 PeerConnection，蓝衣人物播报 115 帧，浏览器视频解码 25 FPS，音视频首帧偏差 20 ms。

### 8.2 2026-07-22 正常速度发布与复验

十个动作恢复 `1.0x` 后重启 `synlive-musetalk.service`。由于 cache key 包含完整 manifest，即使 NPZ、latent 和 mask 本身未变，两个人物 cache 也会自动判旧并重建；本次没有手动删除 cache，也没有重新抽取动作资产。服务在 `86,508.9 ms` 后恢复 `ready=true`，初始化错误为空。

直连 `:8031` 与正式页面 `:8018/musetalk-api` 的 `/health`、`/avatars`、`/actions` 均返回 HTTP 200 和 JSON。Playwright 复验结果如下：

| 项目 | 结果 |
| --- | ---: |
| 纯文本 500 回归 | 前端显示 `HTTP 500`，无 `Unexpected token` |
| 人物画面签名距离 | 62.95，阈值为 3 |
| PeerConnection | 切换前后 created=1、live=1、same=true |
| 蓝衣人物播报 | `welcome`，115 帧，音频 4.625 s |
| 浏览器视频 | 399 帧，25 FPS |
| 音视频首帧偏差 | 0.4 ms |
| 结束状态 | `motion-host`、idle、active=null、queued=0、peers=0 |

另录制暖色人物正常速度 `welcome` 实际 WebRTC 样本，mask 外回源匹配得到连续 100 个动作帧，匹配范围为源索引 0-99。视觉冻结转移为 `4/99 = 4.04%`，来自 NPZ 内原本就存在的重复 RGB 帧，不再是 planner 慢放造成的连续持帧。对全部动作按运行时 once/ping-pong 顺序逐字节复算，冻结率为 `2.99%-5.97%`，全部低于 7% 验收线。

## 9. 使用方式

1. 打开 `http://10.2.42.21:8018/app/live`；
2. 选择“动作主播 · MuseTalk 1.5”；
3. 点击“连接 MuseTalk”；
4. 在“MuseTalk 直播人物”中选择“暖色女主播”或“蓝衣男主播”；
5. 选择自动匹配或具体动作后进行播报；
6. 切换人物时不需要重新点击连接。

服务状态检查：

```bash
curl -fsS http://127.0.0.1:8031/health | jq
curl -fsS http://127.0.0.1:8031/avatars | jq
curl -fsS http://127.0.0.1:8031/actions | jq
```

## 10. 已知限制与后续生产要求

1. **源演员本来在说话。** MuseTalk 能覆盖嘴部像素，但不能消除底片已有的下颌、脸颊和颈部运动；这仍是当前口型“不完全贴合”的最大素材因素。
2. **当前只允许内部 PoC。** 两段视频没有独立的生产肖像、表演和商用授权，不能直接上线公开直播。
3. **蓝衣人物动作语义有限。** 源视频没有标准的欢迎和感谢手势，当前区间用于验证切换与动作机制，不应包装成生产级语义动作。
4. **动作库是预录有限集合。** 系统不是任意肢体动作生成器；每个正式人物都要录制自己的 idle、talk 和手势素材。
5. **当前生产配置不再使用低倍速。** 两个人物的十个动作均为 `1.0x`，不会再由 planner 慢放而重复身体帧；底片自身的重复帧或编码节奏仍由源素材决定。分数倍速能力继续保留，但未来若重新启用，必须单独复核动作节奏和嘴部融合观感。
6. **jaw 融合区仍可能有图层感。** 当前 `upper_boundary_ratio=0.55` 会重建嘴部、脸颊和下巴的一部分。先用正常速度排除慢放带来的放大效应；若问题仍存在，再单独进行 `0.55` 与 `0.60` A/B，不与速度调整同时发布。
7. **人物在启动时全部预载。** 这样可以即时切换，但人物数量继续增加会提高 CPU 内存、neutral 预生成时间和 cache 数量；生产版需要按容量决定常驻或 LRU 策略。
8. **服务仍是单渲染会话。** 新 `/offer` 会关闭旧 peer，适合当前中控台，不是为每个观看用户独立执行一份 GPU 推理。
9. **TTS 不是流式。** 首响包含完整 Azure TTS、特征提取、首批 MuseTalk 推理和 120 ms 缓冲；本轮目标是动作与人物切换，不是降低 TTS 首包延迟。
10. **尚未做长时稳定性验收。** 已覆盖功能、竞态和短时真实媒体链路，生产前仍需 30 分钟、2 小时和 8 小时的显存/RSS/队列增长测试。

正式素材建议由同一演员在固定机位、焦距、曝光、背景、服装下重新录制：全程静默、嘴和下颌中性、近正脸或小幅 yaw、手和商品不遮嘴，每个动作首尾回到统一中性姿态，并归档肖像、表演、声音和商业使用授权。

## 11. 2026-07-22 QuickTalk 离线替代模型 A/B

### 11.1 测试边界与固定输入

针对“人物身体在动、嘴部变化弱、下半脸像独立图层”的反馈，本轮先验证方案 1：不替换、不重启 `:8031`，只在物理 GPU 1 上离线运行 QuickTalk，再和当前 MuseTalk 1.5 做同输入 A/B。OpenTalking checkout 位于：

```text
/data/llm_model/opentalking
commit 69af1069eab3d736798b406e79801d6a600f581b
```

三组输入均固定为 `360 x 624`、25 FPS、100 帧、4 秒，使用同一段 48 kHz 双声道 PCM WAV、同一组 `1.0x` planner 动作帧和同一帧顺序：

| 测试组 | 100 帧 planner 序列 | 固定输入目录 |
| --- | --- | --- |
| `welcome` | `welcome:0-99` | `artifacts/quicktalk-ab/welcome/` |
| `point` | `point:0-64` 后回落 `talk_subtle:0-34` | `artifacts/quicktalk-ab/point/` |
| `talk-subtle` | `talk_subtle:0-74` 后反向 `73-49` | `artifacts/quicktalk-ab/talk-subtle/` |

`point` 与 `talk-subtle` 额外保存了包含 100 组 RGB、face box 和六点 landmarks 的 composite planner NPZ。三组 manifest、ffprobe、PCM 区间、逐帧 source identity 和 SHA-256 均已校验；QuickTalk 输出也保持 100 帧、25 FPS、4 秒，没有通过修改播放速度改善观感。

QuickTalk 权重约 1.89 GiB，核心文件 SHA-256 与模型卡记录一致。OpenTalking 代码采用 Apache-2.0，但 `datascale-ai/quicktalk` 权重卡只标记 `license: other`，所以本轮结论仅适用于内部 PoC，不能据此认定可公开或商用。

### 11.2 冷启动、预热与持续性能

第一次真实形状推理存在约 4.3 秒冷启动，单独看冷进程会得到约 17 FPS，不能满足实时首帧要求。为区分一次性冷路径和持续性能，本轮在同一 Python PID、同一 model/avatar/worker 下连续运行三次，并在第三次前重新创建全零 session state：

| 指标 | 冷 Run 1 | 热 Run 2 | 热 worker + fresh state Run 3 |
| --- | ---: | ---: | ---: |
| 4 秒音频特征 | 116.12 ms | 28.97 ms | 28.93 ms |
| 首帧 | 4,312.94 ms | 15.47 ms | 15.55 ms |
| 100 帧渲染 | 5.766 s | 1.537 s | 1.533 s |
| 100 帧吞吐 | 17.34 FPS | 65.06 FPS | 65.24 FPS |
| 去首帧持续吞吐 | 68.14 FPS | 65.09 FPS | 65.28 FPS |

Run 3 的 state 从 `frame_index=0`、`hn/cn` 全零开始，输出 SHA-256 与 fresh Run 1 完全一致。这说明 15 ms 级热首帧不依赖复用旧 LSTM 状态，也不会改变规范的 `0-99` 模板帧顺序。

另起独立冷进程验证上线预热流程：

```text
load_model / load_avatar
  -> adapter.warmup(state)
  -> CUDA synchronize
  -> worker.make_state()
  -> ready
  -> 第一条真实 utterance
```

实测 model/avatar 初始化 `4.972 s`，启动期预热 `4.468 s`。预热后的第一条真实 utterance 使用 fresh state，音频特征 `82.72 ms`、首帧 `16.70 ms`、100 帧 `1.533 s / 65.21 FPS`；从开始提取特征到拿到首帧约 `99.4 ms`。因此 QuickTalk 服务只有在 `adapter.warmup + CUDA synchronize` 完成后才可以标记 ready。

该进程约占 `1,898 MiB` nvidia-smi 显存，PyTorch render peak allocated 约 `917 MiB`，全进程最大 RSS 约 `2.38 GiB`。测试通过 `CUDA_VISIBLE_DEVICES=1` 隔离到物理 GPU 1；物理 GPU 2 上的 MuseTalk `:8031` PID、显存和 ready 状态前后未变。

### 11.3 三动作画质结果

下表使用统一几何 ROI。嘴部活动越高表示相邻帧嘴区像素变化更充分；脸颊/下巴 MAE、变化像素率和残差时序 MAD 越低，表示越少出现与底片无关的下半脸图层变化。

| 动作 | 嘴部活动 MuseTalk -> QuickTalk | 嘴部活动变化 | 脸颊/下巴 MAE 变化 | 脸颊/下巴变化像素率变化 | 脸颊/下巴残差 MAD 变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `welcome` | 7.669 -> 8.860 | +15.5% | -43.5% | -54.8% | -41.3% |
| `point` | 5.733 -> 6.945 | +21.1% | -39.4% | -51.6% | -34.9% |
| `talk-subtle` | 4.578 -> 5.580 | +21.9% | -36.1% | -48.0% | -34.9% |

三组结果方向一致：QuickTalk 的张口、闭口、圆唇和牙齿变化更明显，同时脸颊/下巴改动范围约减半，残差时序变化降低约 35%-41%。这比继续只调 MuseTalk jaw mask 更直接地命中了“嘴不怎么动、脸层反而明显”的问题。

仍需保留两项限制：

1. QuickTalk 的嘴区 Lab pumping 没有在三组中一致改善：`welcome` 比 MuseTalk 高约 9.7%，`point` 低约 4.1%，`talk-subtle` 基本持平；不能宣称所有嘴部边缘/颜色问题都已解决。
2. MuseTalk 基线来自真实 WebRTC 录屏再截取，QuickTalk 来自离线直接渲染。后续编码统一为 H.264 High、slow/CRF10 和 AAC 192k，并使用 outside-face control，但 MuseTalk 仍多一代实时采集编码；绝对 MAE 不是纯模型分数。嘴部活动也不是 phoneme-level lip-sync 指标，最终仍需带声音盲看。

### 11.4 盲评材料

三组都提供只显示 `A` / `B`、不显示模型名的并排视频和嘴部接触表。A/B 顺序不是人工选择，而是由固定 WAV 的 SHA-256 首个十六进制位奇偶确定，映射单独保存在 key JSON：

| 动作 | 盲评视频 | 嘴部接触表 | 映射 key |
| --- | --- | --- | --- |
| `welcome` | `artifacts/quicktalk-ab/welcome/welcome-blind-ab.mp4` | `artifacts/quicktalk-ab/welcome/welcome-blind-mouth-contact-sheet.png` | `artifacts/quicktalk-ab/welcome/welcome-blind-key.json` |
| `point` | `artifacts/quicktalk-ab/point/point-blind-ab.mp4` | `artifacts/quicktalk-ab/point/point-blind-mouth-contact-sheet.png` | `artifacts/quicktalk-ab/point/point-blind-key.json` |
| `talk-subtle` | `artifacts/quicktalk-ab/talk-subtle/talk-subtle-blind-ab.mp4` | `artifacts/quicktalk-ab/talk-subtle/talk-subtle-blind-mouth-contact-sheet.png` | `artifacts/quicktalk-ab/talk-subtle/talk-subtle-blind-key.json` |

最终盲评视频均为 `720 x 624`、25 FPS、100 帧，视频流和音频流都严格为 4.000 秒。生成脚本不能在当前 FFmpeg 4.2 上同时使用 `-frames:v 100`：达到视频帧上限会提前终止并行 AAC 编码；最终实现改为只用 `-t 4`，并同时复核视频帧数和音轨时长。

完整机器校验报告位于：

```text
artifacts/quicktalk-ab/validation-report.md
artifacts/quicktalk-ab/validation-report.json
```

### 11.5 当前决策

QuickTalk 已通过本轮离线技术门槛：三动作均改善嘴部活动和下半脸稳定性，预热后首用户首帧约 16.7 ms，持续吞吐约 65 FPS，显存和 RSS 也可接受。但现在仍不启动 `:8032`，更不替换 `:8031`，原因是：

1. 尚需由使用者完成三组带声音盲评，确认主观口型、牙齿、嘴色和动作连续性确实更自然；
2. QuickTalk 权重授权仍不明确；
3. Python 3.11 全量环境虽然可以安装，但当前同时装入 CPU `onnxruntime 1.27.0` 与 `onnxruntime-gpu 1.26.0` 后同名模块被 CPU pybind 覆盖，不能作为 CUDA 验收环境；成功渲染来自隔离的 Python 3.10 `.venv-quicktalk`；
4. 还没有验证独立服务中的动作切换、多人 cache、WebRTC 音画同步以及 30 分钟以上的显存/RSS 稳定性。

如果盲评明确胜出，下一步才是在独立端口实现 QuickTalk adapter、启动期真实预热、每会话 fresh state 和现有 `/avatars`、`/actions`、`/offer` 兼容层；MuseTalk `:8031` 始终保留为回退。
