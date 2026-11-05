# AvatarLive

AI 数字人直播中控平台原型。

## 一键部署（Windows / Linux / macOS）

PostgreSQL 使用独立 Compose 生命周期；前端、控制 API、SRS 和统一入口由 Core Compose 管理。
当前部署只使用阿里云数字人、DeepSeek 和百炼语音等云端能力，不部署 Cloudflare
Tunnel、Azure TTS、LiveTalking 或本地 GPU 推理服务。

前置条件：Linux 安装并启动 Docker Engine 与 Compose v2，同时安装 `curl`；macOS 安装并启动
Docker Desktop。脚本不会自动安装 Linux/macOS 的 Docker。

数字人形象的预览视频和封面通过 [预览资源 Release](https://github.com/kenbon49/AvatarLive/releases/tag/avatar-previews-2026-11-05)
单独分发，`git clone` 不包含这些媒体文件。首次构建前，Windows 运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-aliyun-avatar-assets.ps1
```

包含 182 张封面和 170 个原始预览视频；Linux/macOS、离线恢复和重新打包见
[预览资源说明](public/assets/aliyun-avatars/README.md)。

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

`-Install` 会自动检测 WSL 2，安装或修复缺失的 WSL 和内核，再安装缺少的 Git/Docker Desktop，
启动 PostgreSQL 并部署应用。WSL 安装会请求管理员授权；如果需要重启，脚本会暂停，
重启 Windows 后重跑同一命令。只检查环境而不启动服务：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Check
```

Docker Desktop 无法启动时，运行只读诊断并查看生成的报告：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnose-windows.ps1
```

Windows 也可以先双击 `deploy-postgres.cmd`，再双击 `deploy.cmd`。
首次部署无需准备 `.env`：脚本会自动生成基础配置，初始化数据库并显示管理员 `admin` 的随机密码。
脚本确认后端和登录页都就绪后才提示成功；访问 `http://localhost:8018/live`。
DeepSeek 的 URL、Key、模型及百炼语音 Key、服务地址可在管理员系统设置中配置；阿里云数字人凭据和
模板配置写入 `.env` 后重新部署。未配置云服务时仍可启动基础服务。

日常更新运行 `./deploy.sh`（Windows 为 `.\deploy.cmd`），不会启动或重建独立数据库。
也可以继续分两步运行 `deploy-postgres` 和 `deploy` 脚本。

详细前置条件、更新、停止和故障排查见
[`docs/cross-platform-deployment.md`](docs/cross-platform-deployment.md)。

## 百炼语音配置

使用管理员登录，打开 **账号 → 系统设置 → 接口密钥 → 百炼语音 API Key**，
填入百炼北京地域的官方 API Key 并保存。Key 加密保存在本项目数据库中，不回显；
保存或更换后立即生效，无需重启，也无需在外部项目配置。

同一区域的 **百炼服务地址** 默认是 `https://dashscope.aliyuncs.com/api/v1`，
使用北京地域时保持默认即可。填写服务根地址后，项目会自动补全合成和音色注册的接口路径。
选择其他官方地域时，应同时使用该地域的 Key，并确认该地域支持当前语音模型。

也可在 **AvatarLive 项目根目录** `.env` 中提供默认值；后台保存的 Key 优先：

```env
BAILIAN_TTS_API_KEY=你的百炼官方API_Key
BAILIAN_TTS_BASE_URL=https://dashscope.aliyuncs.com/api/v1
```

“试听脚本”和“声音设计”由本项目服务端直接调用百炼 DashScope，无需部署外部语音代理。
只有修改 `.env` 时才需重新部署（`./deploy.sh`，Windows 为 `.\deploy.cmd`）；源码运行则重启后端 API。
Key 为空时基础服务仍可启动，使用语音功能时会提示配置。

官方公共音色首次用于脚本试听时，会在百炼注册对应的克隆音色。注册记录和试听音频保存在
`runtime/bailian-tts/`（Docker 使用 `web_runtime` volume），后续复用音色；更换 Key 或服务地址后会重新注册。
脚本试听使用百炼克隆音色，数字人成片使用灵眸原生音色，两者听感可能有差异。
音色卡片上的官方样例试听读取项目自带音频。
脚本试听使用 `qwen-audio-3.1-tts-plus`，由后端检查音色就绪状态后合成并保存为 WAV。
源码部署时，Web 服务运行用户须能写入 `runtime/bailian-tts/` 和 `runtime/external-api-logs/`；
合成前会检查缓存、音频目录的写入权限，避免注册音色后才发现无法保存。

## 管理员调用日志

**账号 → 日志查看** 位于“系统设置”右侧，仅管理员可访问。
更新后产生的 DeepSeek / 大模型、百炼语音、阿里云数字人、余额查询、素材及图像视频、
Fish Audio、音色克隆、版本检查调用会记录成功或失败结果。
支持按服务、结果和关键词筛选，翻页或每 10 秒自动刷新；展开记录可查看实际地址、HTTP 状态、
耗时、请求 ID、请求参数、返回内容及异常堆栈。
脚本试听还记录完整流程结果；音色注册成功后若合成或保存失败，会另有失败记录及具体原因。

密钥、认证头、签名及文件内容不会写入日志，较长内容会截断。
日志显示最近 7 天仍保留的记录；前后端分别滚动保存最多约 10 MiB，目录为各服务的
`runtime/external-api-logs/`，Docker 随 `web_runtime` 和 `api_runtime` volume 持久化。
历史终端日志不会自动导入。

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
