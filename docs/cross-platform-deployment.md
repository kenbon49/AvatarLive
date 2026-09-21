# AvatarLive 跨平台一键部署

## 支持范围

| 模式 | Windows | Linux | macOS | 包含内容 |
| --- | --- | --- | --- | --- |
| Core | Docker Desktop | Docker Engine / Desktop | Docker Desktop | Web、控制 API、PostgreSQL、Redis、Qdrant、MinIO、SRS、Caddy |
| GPU | Docker Desktop + WSL2 GPU | NVIDIA Driver + Container Toolkit | 不支持本地 CUDA | MuseTalk、MeloTTS、流式聚合 API |

Core 模式可以管理直播间、脚本、素材、账号和推流。数字人口型实时推理依赖 CUDA；
macOS 或没有 NVIDIA GPU 的电脑应连接一台远程 GPU 主机。
部署脚本会启动服务，但云端 LLM、阿里云成片、Azure TTS 等外部能力仍需各自的有效凭据。

## 目录结构

两个仓库应放在同一个父目录：

```text
workspace/
  AvatarLive/
  AvatarLive-backend/
```

```bash
git clone --branch feat/avatar-design https://github.com/kenbon49/AvatarLive.git
git clone --branch feat/avatar-design https://github.com/kenbon49/AvatarLive-backend.git
```

只运行 Core 时可以不克隆 `AvatarLive-backend`。

## 首次启动

前置条件只有 Git 和 Docker。Windows/macOS 安装 Docker Desktop，Linux 安装 Docker
Engine 与 Compose v2。Docker daemon 必须已经启动。

Linux / macOS：

```bash
cd AvatarLive
./deploy.sh
```

Windows PowerShell：

```powershell
Set-Location AvatarLive
.\deploy.ps1
```

Windows 资源管理器中也可以双击 `deploy.cmd`。脚本会自动：

1. 从 `.env.example` 创建不会提交到 Git 的 `.env`。
2. 生成 PostgreSQL、MinIO 和平台凭据加密密钥。
3. 构建并启动 Core 容器。
4. 执行数据库迁移。
5. 在空数据库中创建唯一的初始管理员并显示随机密码。
6. 等待 `http://localhost:8018/health/ready` 成功后再返回。

公网 Cloudflare Tunnel 不会默认启动。将 token 放入
`secrets/cloudflare-tunnel-token` 后，可加 `--tunnel`（PowerShell 为 `-Tunnel`）启用。
旧版 `scripts/deploy-full.sh` 检测到已有 token 时仍会自动启用 Tunnel。

初始管理员凭据保存在 Docker 的 `synlive_api_runtime` volume，不写入代码、镜像或
`.env`。再次查看：

```bash
docker compose -f infra/docker-compose.yml exec -T api \
  cat /app/runtime/admin/initial-admin.txt
```

请妥善保存初始密码，并限制能够访问 Docker daemon 和该 volume 的系统账号。
凭据已转存后可删除容器中的 `initial-admin.txt`；管理员账号仍留在数据库中。

## 完整 GPU 启动

Linux 需要 NVIDIA 驱动和 NVIDIA Container Toolkit；Windows 需要 Docker Desktop 的
WSL2 后端与 NVIDIA GPU 容器支持。确认 `nvidia-smi` 和 Docker GPU runtime 正常后执行：

```bash
./deploy.sh --gpu
```

```powershell
.\deploy.ps1 -Gpu
```

脚本会调用相邻 `AvatarLive-backend` 的部署入口，检查模型文件；缺失时通过临时 Python
容器下载约数 GB 权重，然后构建并启动：

- MuseTalk：`8083`
- MeloTTS：`8084`
- 流式聚合 API：`8085`

自定义目录布局可使用 `--backend-dir PATH` 或 PowerShell 的 `-BackendDir PATH`。
已有模型环境可在后端入口传 `--no-model-download`，缺文件时立即失败而不下载。

## 配置外部服务

部署不要求在首次启动前填写商业 API 密钥；未配置的功能会保持不可用。编辑根目录
`.env` 后重新运行同一部署命令即可。常用配置包括：

- `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`
- `LITELLM_LLM_BASE_URL` / `LITELLM_LLM_API_KEY`
- `AZURE_SERVICE_KEY`
- `SEO_IMAGE_API_*` / `SEO_VIDEO_API_*`

不要提交 `.env`。生产部署还应修改 `ACCESS_HOST`、`CORS_ORIGINS`、`SRS_CANDIDATE`
以及浏览器可访问的 WebSocket 地址。
PostgreSQL、Redis、Qdrant、MinIO、API 和 SRS 管理端口默认通过 `DATA_BIND_HOST`
绑定 `127.0.0.1`，不向公网暴露；统一入口 `ACCESS_PORT` 与媒体端口仍须由防火墙保护。
GPU 聚合服务不会自动启用本地 Ollama，也不会生成 LLM API Key；问答功能需要有效的
OpenAI-compatible 模型地址、凭据和 `SERVER_TOTAL_LITELLM_MODEL`。

## 远程 GPU

在 GPU Linux 主机进入 `AvatarLive-backend` 并运行 `./deploy.sh`。在 Core 主机的
`AvatarLive/.env` 中配置私网或 VPN 地址，例如：

```dotenv
MUSETALK_ADMIN_DOCKER_UPSTREAM=http://10.0.0.20:8083
MUSETALK_TOTAL_UPSTREAM=http://10.0.0.20:8085
```

然后重新运行 Core 部署命令。不要把 8083/8084/8085 直接暴露到公网；跨公网部署应使用
VPN 或带鉴权和 TLS 的反向代理。

## 更新与停止

更新不会删除数据库和缓存 volume：

```bash
git -C ../AvatarLive-backend pull --ff-only
git pull --ff-only
./deploy.sh --gpu
```

Windows 使用相同的 `git pull`，然后执行 `.\deploy.ps1 -Gpu`。

停止并保留数据：

```bash
./stop.sh --gpu
```

```powershell
.\stop.ps1 -Gpu
```

`--purge` / `-Purge` 会删除数据库、对象存储和缓存 volume，属于不可恢复的数据清理，
只应在确认不需要现有数据时使用。

## 常见检查

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs --tail 100 api web proxy
curl http://localhost:8018/health/ready
```

GPU 服务首次构建和首次头像预处理可能需要较长时间。失败时在后端仓库执行：

```bash
docker compose -f docker-compose.local.yml logs --tail 100 musetalk tts server-total
python3 scripts/prepare_models.py --check
```
