# AvatarLive 跨平台一键部署

## 支持范围

| 模式 | Windows | Linux | macOS | 包含内容 |
| --- | --- | --- | --- | --- |
| Database（独立） | Docker Desktop | Docker Engine / Desktop | Docker Desktop | PostgreSQL 与持久化数据卷 |
| Core / Cloud | Docker Desktop | Docker Engine / Desktop | Docker Desktop | Web、控制 API、SRS、Caddy、阿里云形象、百炼语音与 DeepSeek API |

Core / Cloud 模式可以管理直播间、脚本、素材、账号和推流，并使用云端形象、语音和模型；
它不需要 AvatarLive-backend、CUDA、GPU 或模型权重。Cloudflare Tunnel、Azure TTS、
LiveTalking、MuseTalk、MeloTTS、Redis、Qdrant 和 MinIO 不属于当前部署链路。云端 LLM、
阿里云成片和百炼语音服务仍需各自的有效凭据。

## 目录结构

部署只需要 `AvatarLive` 仓库：

```text
workspace/
  AvatarLive/
```

```bash
git clone --branch main https://github.com/kenbon49/AvatarLive.git
```

## 首次启动

前置条件是 Git 和 Docker。Windows/macOS 安装 Docker Desktop，Linux 安装 Docker
Engine 与 Compose v2，Linux 还需安装 `curl`。Docker daemon 必须已经启动。
Linux/macOS 脚本不会自动安装 Docker。Windows 可用 `-Install` 让脚本通过
`winget` 安装 WSL、Git 和 Docker Desktop，并自动检测和修复缺失的 WSL 2 内核。

Linux / macOS：

```bash
cd AvatarLive
./deploy.sh --with-postgres
```

Windows PowerShell：

```powershell
Set-Location AvatarLive
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -WithPostgres
```

首次部署且尚未安装 Git 或 Docker Desktop：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Install
```

只检测环境、不启动容器：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Check
```

`-Install` 会先检测 WSL 是否可用并将默认版本设为 2。WSL 未安装或内核缺失时，
脚本会请求管理员授权，启用“适用于 Linux 的 Windows 子系统”和“虚拟机平台”，
通过 `winget` 安装/更新 `Microsoft.WSL`，再更新内核；不安装 Ubuntu 等用户分发版。
内核更新优先使用 `wsl --update --web-download`，避免依赖已暂停的 Windows 更新，
不支持该选项时再尝试普通 `wsl --update`。
如果系统组件或 WSL 安装要求重启，脚本会停止本次部署并提示重启 Windows，
重启后重跑同一命令；脚本不会自动重启电脑。WSL 就绪后才安装其余依赖、部署 PostgreSQL 和应用。
安装流程会尝试启动 Docker Desktop，并以 2 秒间隔检查引擎，最多检查 90 次；
检测失败时保留 Docker 返回的诊断信息，超时后停止部署并提示排查步骤。
`--with-postgres` / `-WithPostgres` 显式包含数据库部署，日常更新不加该选项。
也可以继续分两步运行 `./deploy-postgres.sh`、`./deploy.sh`；Windows 对应
`deploy-postgres.ps1`、`deploy.ps1`，或先双击 `deploy-postgres.cmd` 再双击 `deploy.cmd`。
部署流程会：

1. 从 `.env.example` 创建不会提交到 Git 的 `.env`。
2. 生成 PostgreSQL 和平台凭据加密密钥。
3. 独立启动 PostgreSQL 并等待数据库就绪。
4. 构建并启动 Core 容器；Core 部署不会启动、停止或删除 PostgreSQL。
5. 执行数据库迁移，在空数据库中创建唯一的初始管理员并显示随机密码。
6. 等待 `http://localhost:8018/health/ready` 和 `/login` 都成功后再返回。

Docker 部署的统一入口默认是 `8018`；源码开发的 `npm run dev` 前端默认是 `3000`。
二者采用不同的启动方式。数据库/API/媒体端口被其他服务占用时，须先调整 `.env` 中对应端口。

初始管理员凭据保存在 Docker 的 `synlive_api_runtime` volume，不写入代码、镜像或
`.env`。再次查看：

```bash
docker compose -f infra/docker-compose.yml exec -T api \
  cat /app/runtime/admin/initial-admin.txt
```

请妥善保存初始密码，并限制能够访问 Docker daemon 和该 volume 的系统账号。
凭据已转存后可删除容器中的 `initial-admin.txt`；管理员账号仍留在数据库中。

## 配置外部服务

部署不要求在首次启动前填写商业 API 密钥；未配置的功能会保持不可用。
首次登录管理员账号后，在系统设置中填写 LLM 的 URL、Key 并读取模型列表、选择默认模型，
保存后立即生效。新环境默认地址为 `https://api.deepseek.com`，默认模型为 `deepseek-flash`。
后台保存在数据库中的 LLM 配置优先于 `.env`；也可在 `.env` 使用 `LLM_BASE_URL`、
`LLM_API_KEY`、`LLM_DEFAULT_MODEL_ID`，旧 `LITELLM_LLM_*` 变量名继续兼容。

百炼语音在 **账号 → 系统设置 → 接口密钥 → 百炼语音 API Key** 中填写北京地域的
官方 Key。保存后立即用于脚本试听和声音设计，无需重启；密钥加密存入本项目数据库，
不会回显。后台保存的值优先于根目录 `.env` 的 `BAILIAN_TTS_API_KEY`。
同一区域可设置 **百炼服务地址**，北京地域默认 `https://dashscope.aliyuncs.com/api/v1`，
无需另填完整合成接口路径；保存后立即生效。其他地域须使用对应 Key，并确认模型可用。

以下服务配置需编辑根目录 `.env`，然后重新运行应用部署命令：

- `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_LINGMOU_TEMPLATE_ID` / `ALIYUN_LINGMOU_REGION_ID`
- `SEO_VOICE_API_BASE_URL` / `SEO_VOICE_API_KEY`：可选的素材解析及 Fish Audio 参考声音服务。

百炼语音也支持通过本项目根目录 `.env` 提供默认 Key：

```env
BAILIAN_TTS_API_KEY=你的百炼官方API_Key
BAILIAN_TTS_BASE_URL=https://dashscope.aliyuncs.com/api/v1
```

通过 `.env` 修改后重新运行 `./deploy.sh`（Windows 为 `.\deploy.cmd`）；源码运行则重启后端 API。
无需在其他项目中配置百炼 Key，也无需为“试听脚本”部署外部语音代理。
音色注册记录与试听音频保存在 Web 服务的 `runtime/bailian-tts/`，随 `web_runtime` volume 持久化；
更换 Key 或服务地址后会重新注册对应账号的音色。
脚本试听使用 `qwen-audio-3.1-tts-plus`，通过当前官方 `voice-enrollment` 接口创建和查询音色，
确认音色就绪后调用 `/services/audio/tts/SpeechSynthesizer` 合成，由 Web 服务下载保存为 WAV。
源码部署须确保 Web 服务运行用户对 `runtime/bailian-tts/` 和 `runtime/external-api-logs/`
具有写入权限；不要使用其他用户预先创建只读运行目录。合成前会实际检查目录写入，
失败时提示权限或磁盘问题，管理员日志同时记录完整试听流程及异常原因。

管理员可在 **账号 → 日志查看** 查看更新后产生的外部接口调用、返回和报错详情，
支持筛选、翻页和自动刷新。日志不包含密钥和文件内容，并会截断较长内容。
前后端的 `runtime/external-api-logs/` 各自最多滚动保留约 10 MiB，页面展示其中最近 7 天的记录；
Docker 使用现有的 `web_runtime` / `api_runtime` volume，无需额外服务或日志配置。

阿里云设置在后台保存后仍需应用到 `.env` 并重新部署；后台保存不会更新 Web 容器的环境变量。

不要提交 `.env`。生产部署还应修改 `ACCESS_HOST`、`CORS_ORIGINS`、`SRS_CANDIDATE`
以及浏览器可访问的媒体地址。
PostgreSQL、API 和 SRS 管理端口默认通过 `DATA_BIND_HOST`
绑定 `127.0.0.1`，不向公网暴露；统一入口 `ACCESS_PORT` 与媒体端口仍须由防火墙保护。
问答功能需要有效的 OpenAI-compatible 模型地址和凭据。

弹幕 OCR 的窗口采集依赖浏览器安全上下文。浏览器与服务在同一台电脑时，可以通过
`http://localhost:<端口>` 访问；从其他电脑通过局域网 IP 访问时，需要 HTTPS，普通
`http://<局域网 IP>:<端口>` 会被浏览器禁用窗口共享。也可以将远程端口转发到本机后
通过 `localhost` 访问。

## 更新与停止

更新 Core 不会重启或删除独立 PostgreSQL。默认只更新 Core / Cloud 服务：

```bash
git pull --ff-only
./deploy.sh
```

Windows 使用相同的 `git pull`，然后执行 `.\deploy.ps1`。

停止并保留数据：

```bash
./stop.sh
```

```powershell
.\stop.ps1
```

`--purge` / `-Purge` 只清理 Core 的运行数据 volume，不会删除独立 PostgreSQL 数据卷。
数据库停机、备份和删除必须通过 `infra/docker-compose.postgres.yml` 单独操作。

从旧版“一体化 Compose”首次升级时，先运行一次 `./stop.sh`（Windows 为 `.\stop.ps1`），
让旧 Core 编排停止原 PostgreSQL 容器；数据仍保留在 `synlive_postgres_data`。随后按顺序运行
`./deploy-postgres.sh` 和 `./deploy.sh`（Windows 使用对应 PowerShell 脚本），独立数据库会继续挂载原数据卷。

## 常见检查

### Windows：Docker Desktop 无法启动

如果 `-Install` 提示 `Docker Desktop is unable to start`，运行一键诊断：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnose-windows.ps1
```

报告会显示 Windows 版本、上次启动时间、虚拟化状态、WSL 版本和分发版、系统组件与服务、
Docker Desktop 后端设置，以及本次启动的最后 60 行错误日志。报告同时保存在
`runtime/deploy-diagnostics/windows-docker-*.log`；部署检查发现 Docker 无法启动时也会自动保存。
诊断只读取状态和生成报告；启动配置的读取需要管理员权限，未提权时会记录查询失败并继续其他检查。
WSL 重定向输出按其实际编码解码，以保留中文错误信息。超过 2000 字符的 Docker 日志行会截短；
需要完整日志时运行 `docker desktop logs --priority 2 --boot 0`。

报告会分别检测 WSL 安装目录、`Windows\System32` 和终端命令解析到的 WSL 入口，并显示
每条命令的完整路径和退出码。如果终端的 `wsl --version` 成功，但 Docker 日志显示
`C:\Windows\System32\wsl.exe --version` 不支持该参数，应比较这些入口的结果；
更新 WSL 后重启 Docker Desktop，再看最新日志，确认是否仍有相同错误。

`HypervisorPresent=True` 表示 Windows 虚拟化已经运行；此时结合 WSL 版本和 Docker Desktop
的具体错误日志继续排查。`False` 时检查系统组件启用后是否已经重启，以及 BIOS/UEFI 虚拟化、
虚拟机的嵌套虚拟化和 `hypervisorlaunchtype` 启动配置。
虚拟机监控程序运行时，处理器的虚拟化属性仍可能显示 `False`，不能仅凭这些属性判断 BIOS 虚拟化未开启。
部分服务按需启动，单独的 `Stopped` 状态也不能证明该服务故障。

报告时间带有本地时区；Docker 日志时间末尾的 `Z` 表示 UTC，中国时间需要加 8 小时。
`--boot 0` 选择的 Docker 启动日志可能早于 WSL 安装或修复。若各 WSL 入口现已正常，
先重启 Windows（系统组件安装要求重启时）和 Docker Desktop，再查看新日志，确认旧错误是否仍在发生。

也可单独运行：

```powershell
wsl --status
wsl --version
wsl -l -v
Get-CimInstance Win32_ComputerSystem | Select-Object HypervisorPresent
docker desktop logs --priority 2 --boot 0 | Select-Object -Last 60
```

若 `wsl --status` 显示“未找到 WSL 2 内核文件”，重跑 `deploy.ps1 -Install` 会自动安装/修复；
请允许系统的管理员授权请求。也可以使用**管理员 PowerShell**手动修复内核：

```powershell
wsl --update
```

如果 Windows 更新已暂停，导致更新无法完成，可先恢复 Windows 更新后重试；
也可按照微软的 [WSL 2 内核安装说明](https://aka.ms/wsl2kernel) 安装与系统架构对应的内核包。
完成后重启 Windows，打开 Docker Desktop，等待引擎启动，再验证并重新部署：

```powershell
docker info
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Install
```

`docker info` 必须能正常返回 `Server` 信息。`wsl -l -v` 显示没有已安装的分发版，
本身不表示必须安装 Ubuntu；Docker Desktop 会管理自己的 WSL 环境。
若内核修复后仍无法启动，检查 BIOS/UEFI 中的硬件虚拟化，以及 Windows 的
“适用于 Linux 的 Windows 子系统”和“虚拟机平台”功能是否启用；
使用 WSL 后端时，Docker Desktop 设置中的 `Use the WSL 2 based engine` 也应开启。

Windows PowerShell 5.1 会将部分外部命令的标准错误转成 `NativeCommandError`。
部署脚本的环境和就绪检测会捕获这些输出并检查退出码，使引擎、数据库启动期间的预期失败可以重试；
`-Check` 只输出诊断，不安装或修复系统组件；自动修复须使用 `-Install`。

### 容器和服务状态

```bash
docker compose -f infra/docker-compose.postgres.yml --env-file .env ps
docker compose -f infra/docker-compose.yml --env-file .env ps
docker compose -f infra/docker-compose.yml --env-file .env logs --tail 100 api web proxy
curl http://localhost:8018/health/ready
```
