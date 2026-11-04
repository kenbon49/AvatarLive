# AvatarLive

AI 数字人直播中控平台原型。

## 一键部署（Windows / Linux / macOS）

PostgreSQL 使用独立 Compose 生命周期；前端、控制 API、SRS 和统一入口由 Core Compose 管理。
当前部署只使用阿里云数字人、DeepSeek 和百炼语音等云端能力，不部署 Cloudflare
Tunnel、Azure TTS、LiveTalking 或本地 GPU 推理服务。

前置条件：Linux 安装并启动 Docker Engine 与 Compose v2，同时安装 `curl`；macOS 安装并启动
Docker Desktop。脚本不会自动安装 Linux/macOS 的 Docker。

Linux / macOS 首次部署（在仓库根目录运行）：

```bash
./deploy.sh --with-postgres
```

Windows 已安装并启动 Docker Desktop 时：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -WithPostgres
```

Windows 首次部署且尚未安装依赖时使用（需要 `winget`）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Install
```

`-Install` 会安装缺少的 Git/Docker Desktop，启动 PostgreSQL，再部署应用；如果安装要求重启，
重启并等待 Docker Desktop 就绪后重跑该命令。只检查环境而不启动服务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Check
```

Windows 也可以先双击 `deploy-postgres.cmd`，再双击 `deploy.cmd`。
首次部署无需准备 `.env`：脚本会自动生成基础配置，初始化数据库并显示管理员 `admin` 的随机密码。
脚本确认后端和登录页都就绪后才提示成功；访问 `http://localhost:8018/live`。
DeepSeek 的 URL、Key、模型及百炼语音 Key 可在管理员系统设置中配置；阿里云数字人凭据和
模板配置写入 `.env` 后重新部署。未配置云服务时仍可启动基础服务。

日常更新运行 `./deploy.sh`（Windows 为 `.\deploy.cmd`），不会启动或重建独立数据库。
也可以继续分两步运行 `deploy-postgres` 和 `deploy` 脚本。

详细前置条件、更新、停止和故障排查见
[`docs/cross-platform-deployment.md`](docs/cross-platform-deployment.md)。

## 百炼语音配置

使用管理员登录，打开 **账号 → 系统设置 → 接口密钥 → 百炼语音 API Key**，
填入百炼北京地域的官方 API Key 并保存。Key 加密保存在本项目数据库中，不回显；
保存或更换后立即生效，无需重启，也无需在外部项目配置。

也可在 **AvatarLive 项目根目录** `.env` 中提供默认值；后台保存的 Key 优先：

```env
BAILIAN_TTS_API_KEY=你的百炼官方API_Key
```

“试听脚本”和“声音设计”由本项目服务端直接调用百炼 DashScope，无需部署外部语音代理。
只有修改 `.env` 时才需重新部署（`./deploy.sh`，Windows 为 `.\deploy.cmd`）；源码运行则重启后端 API。
Key 为空时基础服务仍可启动，使用语音功能时会提示配置。

官方公共音色首次用于脚本试听时，会在百炼注册对应的克隆音色。注册记录和试听音频保存在
`runtime/bailian-tts/`（Docker 使用 `web_runtime` volume），后续复用音色；更换 Key 后会重新注册。
脚本试听使用百炼克隆音色，数字人成片使用灵眸原生音色，两者听感可能有差异。
音色卡片上的官方样例试听读取项目自带音频。

## 源码开发

如果你的终端没有 `pnpm`，直接使用 npm 即可：

```bash
cd AvatarLive
npm install
npm run dev
```

启动成功后打开：

```text
http://localhost:3000
```

`3000` 是源码开发时的前端端口；Docker 一键部署的统一入口默认是 `8018`。
`npm run dev` 只启动前端，完整功能还需按 [`apps/api/README.md`](apps/api/README.md) 启动后端和数据库。

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

以下以源码前端端口 `3000` 为例；Docker 部署使用统一入口端口 `8018`。

- 实时互动首页：http://localhost:3000/
- 直播中控：http://localhost:3000/live
- 直播节目输出窗口：http://localhost:3000/live/program（由直播控制台带会话参数打开）
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

## 后端与兼容入口

后端代码与文档在 `apps/api/`（FastAPI + LiteLLM/DeepSeek）。基础设施编排在 `infra/`。

旧的 `scripts/start.sh`、`scripts/deploy-full.sh` 和 `scripts/stop.sh` 仍可使用，
它们现在转发到根目录的跨平台部署入口。新部署建议直接使用：

```bash
./deploy-postgres.sh
./deploy.sh
./stop.sh
```

`start.sh`/`deploy-full.sh` 会同时启用 Compose 的 `media` profile。SRS 的 RTMP/API 端口分别为 `1935/1985`，WebRTC 使用 UDP `8000`，HTTP-FLV 默认映射到 `18080`（可用 `SRS_HTTP_PORT` 覆盖）。生产环境需把 `SRS_CANDIDATE` 设置为浏览器可达的服务器 IP；控制台会将最终竖屏 Canvas 和数字人音频经同源 WHIP 发布到 SRS，再由 API 为各 RTMP 目标启动独立 FFmpeg。`LIVE_RUN_ALLOW_TEST_PATTERN` 默认关闭。

### 官方直播伴侣窗口采集

直播控制台的“开播编排”现在默认提供“窗口采集（推荐）”模式。该模式不需要平台 RTMP 密钥：点击“打开节目输出窗口”后，控制台会打开 `/live/program` 纯净节目窗口，并通过本机 WebRTC 将合成画面和数字人音频送入窗口。用户在抖音、快手、淘宝等官方直播伴侣中选择该窗口（以及系统声音）后，再由平台客户端完成登录和开播。

节目窗口支持 `9:16` 竖屏手机比例和 `16:9` 横屏 PC 比例。窗口采集只适用于节目窗口与平台客户端运行在同一台电脑的场景；平台客户端的实际开播状态不会回传给 AvatarLive。手工 RTMP 模式仍然保留，适用于账号后台明确提供合法 RTMP/RTMPS 地址和推流密钥的情况。

更多见 `apps/api/README.md` 与 `docs/cross-platform-deployment.md`。
