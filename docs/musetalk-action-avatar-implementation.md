# MuseTalk 1.5 真人动作主播实施说明

> 实施日期：2026-07-21（Asia/Shanghai）
>
> 当前定位：固定真人动作底片上的实时/半实时换嘴方案；FlashHead 继续负责纯头肩模式，LiveAct 继续负责离线高质量生成。
>
> 重要边界：当前 `motion-host` 人物与源视频只允许内部 PoC，且底片演员本身正在说话；它们不是可直接上线的生产人物资产。
>
> **后续状态更新**：动作独立减速、稳定 idle、`blue-host` 第二人物、单模型多 profile cache 和不重连 WebRTC 的人物热切换已经完成。本文保留初版单人物基线；当前资产、接口、测试和部署数据以 `docs/musetalk-motion-tuning-multi-avatar-implementation.md` 为准。

## 1. 为什么替换旧的 FlashHead 身体合成方案

旧 PoC 把 FlashHead 从单张照片生成的完整脸部，贴到另一段真人身体视频上。两边会分别产生头姿、下颌、眼神和表情：

```text
FlashHead 生成脸的运动
  +
真人底片中原有的头部和下颌运动
  -> 2D 对齐与羽化
```

相似变换可以修正平移、统一缩放和 roll，却不能让两套独立的三维脸形、yaw、下颌开合与遮挡完全一致。尤其张嘴时，FlashHead 的脸轮廓会改变，而底片的下颌和颈部仍沿原视频运动，因此会看到脸层相对头发、耳朵或脖子“浮起来”。继续扩大 mask 或增加羽化只能移动接缝，不能消除运动源冲突。

新实现改为只保留一套几何和运动源：

```text
文本 + action
  -> Azure TTS（16 kHz 单声道）
  -> Whisper 音频特征
  -> 动作 planner 选择真人视频当前帧
  -> MuseTalk 1.5 仅生成该帧的嘴部/下半脸
  -> jaw mask 融回同一张目标帧
  -> 360 x 624、25 FPS 视频 + 48 kHz 音频
  -> aiortc / WebRTC
  -> SynLive 页面
```

头姿、头发、脸部外轮廓、颈部、衣服、身体和手势始终来自当前真人帧。MuseTalk 不再生成另一颗完整头部，也不再把一张会自主运动的完整脸贴到身体上。这解决的是旧架构的“双运动源”问题，不代表模型生成的牙齿、唇形和皮肤质感会自动达到生产质量。

旧 PoC 的实现与失败原因保留在 `docs/flashhead-body-motion-poc-implementation.md`，不再作为真人动作主播的继续优化方向。

## 2. SynLive 当前三条渲染路径

| 模式 | 服务 | 用途 | 画面来源 | 当前边界 |
| --- | --- | --- | --- | --- |
| FlashHead Lite | `:8030` | 低延迟纯头肩数字人 | 单图生成连续脸部/头肩帧 | 不与真人身体底片合成，不承担语义肢体动作 |
| MuseTalk 1.5 动作主播 | `:8031` | 真人动作实时/半实时播报 | 真人动作视频当前帧，仅重建嘴部/下半脸 | 动作来自有限素材库；当前人物只限内部 PoC |
| LiveAct | `:5071` | 高质量演示和成片 | 全帧生成 | 离线任务/HLS，不作为实时弹幕默认链路 |

三条路径独立运行。MuseTalk 使用独立端口、独立 GPU 和独立 WebRTC PeerConnection，不替换现有 `:8028` LiveTalking 或 `:8030` FlashHead 服务。SynLive 前端通过 `/musetalk-api/*` 同源代理访问 `:8031`。

## 3. 实现组成

### 3.1 后端

| 文件 | 职责 |
| --- | --- |
| `apps/musetalk/action_runtime.py` | 校验并预载动作资产；提供独立动作 planner、ping-pong/once 播放、`auto` 规则、generation 与打断保护 |
| `apps/musetalk/inference.py` | 加载 MuseTalk 1.5、Whisper、VAE 和人脸解析器；预计算 latent/mask；按批生成并融合下半脸 |
| `apps/musetalk/server.py` | Azure TTS、音频特征、推理队列、25 FPS/48 kHz 媒体时钟、WebRTC、动作 API 和健康状态 |
| `scripts/run-musetalk-demo.sh` | 检查模型、资产、密钥、端口和 Python 环境；隔离 GPU 后启动服务 |
| `infra/systemd/synlive-musetalk.service` | 用户级常驻服务定义，默认端口 `8031`、物理 GPU `2`、batch `8` |

### 3.2 前端与部署

| 文件 | 职责 |
| --- | --- |
| `src/lib/api.ts` | MuseTalk 探活、WebRTC offer、播报、打断、动作列表和动作预览 API |
| `src/components/live-console.tsx` | “动作主播 · MuseTalk 1.5”模式、状态提示、动作选择和 WebRTC 播放 |
| `next.config.ts` | `/musetalk-api/:path*` 到 MuseTalk 服务的同源 rewrite |
| `Dockerfile.web`、`infra/docker-compose.yml` | 将浏览器展示 URL 与宿主机 upstream 分开注入 Web 构建和容器 |
| `.env.example` | `MUSETALK_*` 环境变量示例 |

前端默认仍为 FlashHead；MuseTalk 是可显式选择的独立模式。离开 MuseTalk 模式时，页面会发送 interrupt 并关闭当前连接，避免旧语音继续播放。

## 4. 动作资产

当前资产位于：

```text
public/assets/musetalk-body/motion-host/
  manifest.json
  reference.png
  idle.npz
  talk_subtle.npz
  welcome.npz
  point.npz
  thank.npz
```

manifest 参数：

| 项目 | 当前值 |
| --- | ---: |
| 输出分辨率 | 360 x 624 RGB |
| 帧率 | 25 FPS |
| 总帧数 | 353 |
| `idle` | 75 帧，ping-pong |
| `talk_subtle` | 75 帧，ping-pong |
| `welcome` | 100 帧，once |
| `point` | 65 帧，once |
| `thank` | 38 帧，once |
| 压缩 NPZ 总大小 | 约 123 MiB |

每个 NPZ 包含：

```text
frames                  uint8 [N, 624, 360, 3]，RGB
face_boxes              float32 [N, 4]
face_landmarks          float32 [N, 6, 2]
face_landmarks_valid    bool [N]
```

这套 25 FPS 资产和旧 FlashHead 20 FPS 身体资产分目录保存，不能互相覆盖。否则旧服务的播放速度会变化，缓存身份也会混淆。

当前源视频为：

```text
/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4
```

manifest 已显式记录 `internal_poc_only: true`。该演员没有随仓库提供可用于生产直播的独立肖像授权，且选取的 `idle`、`talk_subtle` 和动作段中演员本身可能正在说话。底片原有嘴和下颌运动不会因为覆盖嘴部像素而消失，可能与新音频的下颌节奏冲突。因此，这批素材只用于确认架构、性能和接口，不应用于评价最终生产人物的口型上限。

生产录制必须满足：演员静默、嘴和下颌尽量中性；同一机位、焦距、曝光、背景和服装；近正脸或小幅 yaw；手和商品不遮嘴；动作首尾回到可切换的中性姿态；同时归档肖像、表演、声音和商业使用授权。

## 5. 模型预处理与融合

### 5.1 启动阶段

`MuseTalkService` 在 aiohttp 启动后异步初始化，初始化未完成时 `/health` 返回 `ready: false`，`/offer` 返回 503。初始化过程为：

1. 读取 manifest，校验动作白名单、帧数、分辨率、RGB dtype、人脸框和关键点；
2. 加载 MuseTalk 1.5 UNet、SD VAE、Whisper 和 face parsing 权重；
3. 对全部 353 帧逐帧裁出人脸，扩展下边界并缩放到 256 x 256；
4. 预计算 VAE latent，并以 FP16 保存到 CPU；
5. 用 `jaw` parsing mask、`upper_boundary_ratio=0.55` 生成全帧 blend mask；
6. 把 latent、face box 和 mask 写入本地 NPZ 缓存；
7. 用固定 batch shape 预热两轮推理，并用静音 Whisper 特征预生成所有待机/无声预览帧；
8. 全部静音帧常驻 CPU 内存后，再把服务标记为 ready。

缓存 key 同时包含 manifest、所有动作 NPZ 和关键模型权重的路径、大小与修改时间。素材、模型或 mask 配置变化会使旧缓存失效。默认缓存路径为：

```text
/data/MuseTalk/results/synlive-cache/motion-host-v15.npz
```

MuseTalk 上游部分资源使用相对 `./models/...` 路径，VAE 和人脸解析器也默认选择可见的 `cuda:0`。启动脚本因此先设置 `CUDA_VISIBLE_DEVICES=2`，再以 `/data/MuseTalk` 为工作目录运行；进程内的 `cuda:0` 对应物理 GPU 2。

### 5.2 颜色与 mask 约定

动作 NPZ 和 aiortc 输出使用 RGB；MuseTalk VAE 与上游 blending 工具按 BGR 约定处理。实现中的颜色路径是：

```text
NPZ RGB -> OpenCV/MuseTalk BGR -> 生成与融合 -> RGB -> av.VideoFrame(rgb24)
```

生成结果只写入 `blend_mask > 0` 的像素。`upper_boundary_ratio=0.55` 会把替换范围限制在较低的脸部区域，避免重新生成眼睛、眉毛、额头和头发。实测对 mask 外像素做逐像素比较，变化像素数为 0；这是实现必须保持的回归约束。

mask 越大，模型更容易重画完整下颌和脸颊，但磨皮、肤色变化、边界漂移和“另一张脸”的感觉也会增加；mask 越小，底片原有唇部或下颌运动可能残留。当前 `0.55` 是本次素材上的工程折中，不是适用于所有人物的固定最优参数。

### 5.3 推理与播放

说话时先完成 TTS，并把 16 kHz PCM 切成 25 FPS 对应的 Whisper 特征。动作 planner 按输出帧数选择目标帧，MuseTalk 以固定 batch 生成脸部，再把结果融回每个目标帧。

首个视频 batch 生成后，服务把音频和视频设置为同一个 `start_at`，默认再缓冲 120 ms，然后同时开放播放。后续 batch 在单独的 GPU executor 中生成并追加到有界视频队列，不阻塞 asyncio 媒体时钟。音频轨输出 48 kHz、每包 960 samples，即 20 ms；视频轨按 manifest 的 25 FPS 输出。

当前不是流式 TTS：整段 Azure TTS 完成后才提取 Whisper 特征和生成首批视频。因此 45 FPS 的稳态模型吞吐不等于文本提交后几十毫秒即可出声，首响还包含 TTS、音频特征、首批推理、120 ms 缓冲、WebRTC 和浏览器解码。

未说话时，视频轨播放启动阶段已经由静音 Whisper 特征预生成的 `idle` 帧，实时媒体循环不再调用 MuseTalk。这样可减少原底片已有说话嘴形在待机时的影响，并避免原片与生成片之间的纹理突变；但当前底片的独立下颌运动仍然存在，不能替代静默素材。动作预览、每次播报和 idle 各有自己的游标，提前生成语音帧不会推进待机画面，也不会串用另一句语音的动作位置。

## 6. 动作与打断语义

服务只接受以下动作：

| ID | 模式 | 行为 |
| --- | --- | --- |
| `auto` | 规则选择 | 根据受限关键词选择动作，未命中时使用 `talk_subtle` |
| `idle` | ping-pong | 静默待机 |
| `talk_subtle` | ping-pong | 普通讲解 |
| `welcome` | once | 播完后，说话中回到 `talk_subtle`，静默预览回到 `idle` |
| `point` | once | 同上 |
| `thank` | once | 同上 |

`auto` 目前只做轻量关键词匹配：欢迎/问候选择 `welcome`，参数/这里/重点等选择 `point`，感谢/下单/告别等选择 `thank`。它不是通用动作理解模型。

每个播报或预览获得单调递增的 generation。新播报、interrupt、WebRTC 重连或服务关闭会使旧 generation 失效；旧推理结果不能清理或覆盖新的会话状态。新 `/offer` 会先打断当前语音并关闭旧 PeerConnection，因此当前服务是单渲染会话，不是每位观众各建一份 GPU 推理。

## 7. HTTP 与 WebRTC API

### 健康状态

```http
GET /health
```

返回 `ready`、模型版本、帧率、分辨率、batch、启动预处理时间、初始化错误、队列状态、动作状态和 `last_timing`。

### 动作列表与无声预览

```http
GET /actions

POST /action
Content-Type: application/json

{
  "action": "point",
  "interrupt": true
}
```

动作预览要求先通过 `/offer` 建立 WebRTC。一次预览按 ping-pong 长度播放一次；一次性动作结束后回到 idle。

### 播报与打断

```http
POST /human
Content-Type: application/json

{
  "type": "echo",
  "text": "请看这里，这款产品的重点参数已经整理好了。",
  "action": "point",
  "interrupt": true
}
```

```http
POST /human
Content-Type: application/json

{
  "type": "interrupt"
}
```

`/human` 接受的文本最长为 5000 字符。`interrupt: true` 会取消当前播报并清空旧队列；未建立 WebRTC 时播报返回 409。

### WebRTC 协商

```http
POST /offer
Content-Type: application/json

{
  "sdp": "...",
  "type": "offer"
}
```

返回 aiortc answer。服务同时提供一个视频轨和一个音频轨。

## 8. 启动与配置

本机默认依赖：

```text
MuseTalk checkout   /data/MuseTalk
Python              /home/super/miniconda3/envs/cyberverse/bin/python
模型版本            MuseTalk 1.5
物理 GPU            2
服务端口            8031
batch               8
```

必要权重：

```text
models/musetalkV15/unet.pth
models/musetalkV15/musetalk.json
models/sd-vae/diffusion_pytorch_model.bin
models/whisper/pytorch_model.bin
models/face-parse-bisent/79999_iter.pth
models/face-parse-bisent/resnet18-5c106cde.pth
```

在仓库根目录配置 `.env` 后启动：

```bash
bash scripts/run-musetalk-demo.sh
```

用户级 systemd：

```bash
systemctl --user link "$PWD/infra/systemd/synlive-musetalk.service"
systemctl --user daemon-reload
systemctl --user enable --now synlive-musetalk.service
systemctl --user status synlive-musetalk.service --no-pager
curl -fsS http://127.0.0.1:8031/health | jq
```

常用环境变量：

| 变量 | 默认值/用途 |
| --- | --- |
| `MUSETALK_ROOT` | `/data/MuseTalk` |
| `MUSETALK_PYTHON` | Cyberverse conda Python |
| `MUSETALK_PORT` | `8031` |
| `MUSETALK_GPU` | `2`，由启动脚本转成 `CUDA_VISIBLE_DEVICES` |
| `MUSETALK_BATCH_SIZE` | `8` |
| `MUSETALK_BODY_MANIFEST` | 当前 25 FPS `motion-host` manifest |
| `MUSETALK_CACHE_PATH` | 预计算 latent/mask 缓存 |
| `MUSETALK_START_BUFFER_SECONDS` | 服务默认 `0.12` |
| `AZURE_SERVICE_KEY` / `AZURE_SPEECH_KEY` | Azure TTS 密钥，二选一 |
| `AZURE_TTS_REGION` / `AZURE_SERVICE_REGION` | Azure 区域，默认 `eastasia` |

生产 Web 容器使用 `MUSETALK_DOCKER_UPSTREAM=http://host.docker.internal:8031`，浏览器始终请求同源 `/musetalk-api/*`，不直接依赖访问者能否连接宿主机的 `localhost:8031`。

## 9. 本机实测结果

以下是 2026-07-21 在物理 GPU 2（NVIDIA RTX 3090 24 GB）上的 MuseTalk 1.5 推理测试。输入使用当前动作帧和预计算 latent/mask；这些数字是模型路径的吞吐测试，不包含 Azure TTS、网络、WebRTC 和浏览器解码。

| 配置 | 结果 |
| --- | ---: |
| batch 4，预热后吞吐 | 34.89 FPS |
| batch 8，预热后吞吐 | 45.07 FPS |
| batch 8 首个实跑 batch | 369 ms |
| PyTorch reserved 显存 | 7.10 GiB |
| 目标播放帧率 | 25 FPS |
| mask 参数 | `jaw`，`upper_boundary_ratio=0.55` |
| mask 外像素变化 | 0 |

batch 8 在当前机器上有足够的稳态吞吐余量，因此作为默认值。首个 batch 369 ms 明显高于稳态单批均值，说明预热和首响仍必须单独记录，不能用 45.07 FPS 反推端到端响应时间。`7.10 GiB` 是这次 PyTorch reserved 指标，不应写成整机显存绝对峰值；驱动、CUDA context 和同时运行的其他进程需要另行观察 `nvidia-smi`。

当前已经验证的视觉不变量是 mask 外像素逐像素不变，它证明头发、眼睛、脸部外轮廓、颈部和身体不会被这条合成路径重新绘制。它不等于 lip-sync 主观质量已经合格，也不能消除底片演员原有下颌运动。

动作状态机的自动选择、白名单、ping-pong、once 回落、独立游标、generation、interrupt、manifest/NPZ 边界校验由 `tests/test_musetalk_action_runtime.py` 覆盖；mask/RGB-BGR、媒体轨和失败恢复由 MuseTalk 后端测试覆盖。完整验收命令包括：

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  -m unittest discover -s tests -v

corepack pnpm typecheck
bash -n scripts/run-musetalk-demo.sh
NODE_PATH=/tmp/synlive-browser-check/node_modules \
  PLAYWRIGHT_CHROMIUM_PATH=/home/super/.cache/ms-playwright/chromium-1187/chrome-linux/chrome \
  SYNLIVE_TEST_URL=http://127.0.0.1:3011/app/live \
  node scripts/verify-live-musetalk.cjs
git diff --check
```

2026-07-21 本机实际执行 53 项 Python 测试，全部通过。独立 Next `:3011` + Chromium 的真实浏览器测试也通过：WebRTC 视频为 360 x 624、浏览器统计为 25 FPS，短句收到 77 个生成帧，音频/视频 RTP 都持续增长，首音频与首视频偏差 20.1 ms；动作预览、播报、interrupt、单活 PeerConnection、桌面与 390 px 移动布局均通过，浏览器 console 和 HTTP 错误为 0。另一次 7.39 秒录制得到 184 个生成帧，平均媒体输出约 25 FPS。

这些短时验证不能替代 30 分钟及更长的稳定性测试，也没有解决当前底片本身说话或演员授权问题。

## 10. 已知限制

1. **当前底片不是合格生产素材。** 演员本身在说话，原有唇部和下颌运动会与新语音并存；它只适合内部 PoC。
2. **肖像授权不完整。** 源仓库没有为视频人物单独提供生产直播授权，不能公开或商业使用。
3. **牙齿和口腔仍由模型生成。** 快速张嘴、齿列、舌头、唇内阴影可能出现模糊、闪烁或结构错误。
4. **局部磨皮和身份变化仍可能出现。** MuseTalk 可能改变下半脸纹理、唇色、胡须或皮肤细节；jaw mask 缩小了范围，但没有消除模型误差。
5. **大姿态和遮挡不安全。** 大 yaw/pitch、手掌或商品遮嘴时，二维人脸框和解析 mask 不能恢复正确前后关系。
6. **动作是有限素材。** `welcome / point / thank` 是预录片段，不是模型生成任意新手势；换人物需要重新录制该人物的整套身体素材。
7. **当前为单会话服务。** 新 offer 会关闭旧 peer；多观众应通过 SFU 或转推分发同一条渲染流。
8. **TTS 尚未流式化。** 新文本的首响仍受整段 Azure TTS 和首批推理影响。
9. **预计算缓存占用磁盘和启动时间。** 动作库扩大后要按人物分缓存，并避免所有人物同时常驻内存。

## 11. 生产化前的验收顺序

1. 重录具有完整授权的静默演员动作库，优先保证嘴、下颌中性和动作首尾安全切换；
2. 用同一句测试音频对比原底片、MuseTalk 输出和旧 FlashHead composite，逐帧检查唇形、牙齿、下颌、肤色、mask 边界和遮挡；
3. 记录 TTS、音频特征、首个 batch、浏览器首音频、首视频、音画偏差及 P50/P95，而不只记录模型 FPS；
4. 覆盖连续播报、频繁打断、动作切换、第二次 offer、MuseTalk/FlashHead/LiveAct 往返切换；
5. 完成 30 分钟、2 小时和 8 小时稳定性与显存增长测试；
6. 审计 MuseTalk 代码、模型权重、Whisper/VAE、人脸解析器、Azure TTS、演员肖像和声音的独立许可。

若生产素材重录后，牙齿、唇色或单帧 jitter 仍不可接受，可以在保持“同一目标视频帧”原则的前提下 A/B QuickTalk 或其他 mouth-only backend；不应回到“生成完整脸 + 另一套身体运动”的双运动源结构。
