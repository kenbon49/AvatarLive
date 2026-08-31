# SynLive

AI 数字人直播中控平台原型。

## 本地启动

如果你的终端没有 `pnpm`，直接使用 npm 即可：

```bash
cd /Users/yangcheng/PycharmProjects/SynLive
npm run dev
```

启动成功后打开：

```text
http://localhost:3000
```

如果 3000 端口被占用，可以换端口：

```bash
npm run dev -- --port 3001
```

然后打开：

```text
http://localhost:3001
```

## 可选：使用 Corepack 运行 pnpm

macOS 上如果 `pnpm` 提示 command not found，但有 `corepack`，可以这样运行：

```bash
corepack pnpm dev
```

也可以尝试启用 pnpm shim：

```bash
sudo corepack enable pnpm
```

启用后再运行：

```bash
pnpm dev
```

## 页面入口

- 实时互动首页：http://localhost:3000/
- 直播中控：http://localhost:3000/live
- 数字人定制：http://localhost:3000/design
- 文档入口：http://localhost:3000/docs

`/app/*` 是旧版工作台路径，当前父布局会将其兼容重定向到首页；新的直播推流链路请使用 `/live`。

## 校验命令

```bash
npm run typecheck
npm run build
```

## 模型与本地数据

仓库不提交模型权重、生成张量缓存、训练数据和本地密钥。需要在目标机器上按各子目录 README 重新下载或生成：

- `.train-data/`、`.pnpm-store/`、`node_modules/`、`.next/`
- `*.pt`、`*.pth`、`*.ckpt`、`*.safetensors`、`*.onnx`、`*.gguf`、`*.h5`、`*.pkl`
- `*.npy`、`*.npz`、`*.bin`
- `public/vendor/talkinghead/avatars/*.glb`

## 官网视觉素材

首页使用的图片和视频素材放在：

```text
public/assets/
```

当前包含：

- `hero-live-studio-poster.png`：Hero 区静态真实感主视觉
- `product-live-control.png`：直播中控真实感预览图
- `product-script-timeline.png`：脚本时间线预览图
- `product-stream-health.png`：推流健康预览图
- `solution-commerce.png`：电商直播方案图
- `solution-education.png`：教育培训方案图
- `solution-finance.png`：金融服务方案图
- `solution-gov.png`：政企宣传方案图

如果需要重新生成辅助素材：

```bash
python3 scripts/generate_marketing_assets.py
```

注意：Hero 主视觉和 `product-live-control.png` 当前由 GPT Image 生成，辅助脚本不会覆盖它们。

## 后端 & 一键启动

后端代码与文档在 `apps/api/`（FastAPI，已接入 Azure TTS + LiteLLM/GPT + LiveTalking 客户端）。基础设施编排、数字人渲染部署在 `infra/`。

### 一键脚本

```bash
# 1) 启动后端 docker 栈（postgres/redis/qdrant/minio/srs/api），自动生成 .env
#    可选提前 export AZURE_SERVICE_KEY / LITELLM_LLM_API_KEY 自动注入密钥
./scripts/start.sh
./scripts/start.sh --with-frontend   # 顺带起 Next.js 前端 :3000

# 2) 停止（保留数据）；--purge 连数据一起清
./scripts/stop.sh

# 3) 在 GPU 机器上部署 LiveTalking（渲染节点，跨机接入）
AZURE_SPEECH_KEY=xxxx SRS_HOST=<SynLive主机IP> ./scripts/deploy-livetalking.sh
```

`start.sh`/`deploy-full.sh` 会同时启用 Compose 的 `media` profile。SRS 的 RTMP/API 端口分别为 `1935/1985`，WebRTC 使用 UDP `8000`，HTTP-FLV 默认映射到 `18080`（可用 `SRS_HTTP_PORT` 覆盖）。生产环境需把 `SRS_CANDIDATE` 设置为浏览器可达的服务器 IP；控制台会将最终竖屏 Canvas 和数字人音频经同源 WHIP 发布到 SRS，再由 API 为各 RTMP 目标启动独立 FFmpeg。`LIVE_RUN_ALLOW_TEST_PATTERN` 默认关闭。

更多见 `apps/api/README.md` 与 `infra/livetalking/README.md`。
