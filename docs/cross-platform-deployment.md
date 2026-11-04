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
`winget` 安装 Git 和 Docker Desktop。

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

`-Install` 安装依赖后会部署 PostgreSQL 和应用；如果 Docker Desktop/WSL 安装要求重启，
重启并等待 Docker Desktop 就绪后重跑同一命令。
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

以下服务配置需编辑根目录 `.env`，然后重新运行应用部署命令：

- `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`
- `ALIYUN_LINGMOU_TEMPLATE_ID` / `ALIYUN_LINGMOU_REGION_ID`
- `BAILIAN_TTS_API_KEY`：百炼北京地域官方 Key，本项目直接用于脚本试听及声音设计。
- `SEO_VOICE_API_BASE_URL` / `SEO_VOICE_API_KEY`：可选的素材解析及 Fish Audio 参考声音服务。

百炼语音配置示例（写入本项目根目录 `.env`）：

```env
BAILIAN_TTS_API_KEY=你的百炼官方API_Key
```

填写后重新运行 `./deploy.sh`（Windows 为 `.\deploy.cmd`）；源码运行则重启前端进程。
无需在其他项目中配置百炼 Key，也无需为“试听脚本”部署外部语音代理。
音色注册记录与试听音频保存在 Web 服务的 `runtime/bailian-tts/`，随 `web_runtime` volume 持久化。

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

```bash
docker compose -f infra/docker-compose.postgres.yml --env-file .env ps
docker compose -f infra/docker-compose.yml --env-file .env ps
docker compose -f infra/docker-compose.yml --env-file .env logs --tail 100 api web proxy
curl http://localhost:8018/health/ready
```
