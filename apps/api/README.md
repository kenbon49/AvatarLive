# SynLive API

AI 数字人直播中控平台后端（FastAPI）。当前已提供实时互动 Session 编排，以及独立的直播间控制台配置持久化能力。

## 目录结构

```
app/
  main.py                 # FastAPI 入口（CORS / lifespan / 路由挂载）
  core/                   # config(pydantic-settings)、logging(loguru)
  api/v1/                 # health / tts / live / live_rooms / live_runs 路由
  db/                     # SQLAlchemy engine、Base 和请求级 Session
  models/                 # live_rooms / platform_connections / live_runs 持久化模型
  repositories/           # 数据访问与版本冲突处理
  services/
    tts/                  # Azure TTS（移植自 seo_video_generate，已解耦 Django）
    livetalking/          # LiveTalking 异步客户端（优雅降级）
    live/                 # 实时互动 Session 管理器（保持内存版、与直播间配置隔离）
  schemas/                # 请求/响应模型
migrations/               # Alembic 数据库迁移
```

## 本地运行（无需 Docker）

```bash
cd apps/api
# 配置统一在项目根目录 .env（见根 .env.example）；本地 uvicorn 开发可复制一份到本目录：
cp ../../.env.example .env     # 填入 AZURE_SERVICE_KEY / LITELLM_LLM_API_KEY
# 用项目根目录已有的 .venv（Python 3.13）
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

打开 http://localhost:8000/docs 看 Swagger。

## 接口速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活检查 |
| GET | `/health/ready` | 就绪检查（Azure 是否配置、LiveTalking 地址） |
| GET | `/api/v1/tts/languages` | 16 种语言列表 |
| GET | `/api/v1/tts/voices?lang=zh` | 某语言音色列表 |
| POST | `/api/v1/tts/synthesize` | 文本 → mp3（响应体即音频） |
| GET | `/api/v1/llm/models` | 可用 LLM 列表（GPT/DeepSeek/Gemini/Doubao）+ 默认模型 |
| POST | `/api/v1/llm/chat` | 非流式对话（OpenAI messages 风格） |
| POST | `/api/v1/llm/chat/stream` | SSE 流式对话（meta→content…→done） |
| GET | `/api/v1/llm/persona` | 默认数字人主播人设 |
| POST | `/api/v1/live/sessions` | 创建直播会话 |
| GET | `/api/v1/live/sessions/{id}` | 查询会话 |
| PUT | `/api/v1/live/sessions/{id}/livetalking-session` | 绑定 LiveTalking sessionid |
| POST | `/api/v1/live/sessions/{id}/say` | 编排播报：TTS + 驱动数字人 |
| POST | `/api/v1/live/sessions/{id}/answer` | 弹幕问答编排：问题→LLM→TTS→数字人 |
| GET/POST | `/api/v1/live-rooms` | 查询或创建直播间控制台配置 |
| GET/PUT | `/api/v1/live-rooms/{id}` | 读取或保存直播间配置 |
| POST | `/api/v1/live-rooms/{id}/copy` | 复制直播间 |
| POST | `/api/v1/live-rooms/{id}/publish` | 发布直播间配置 |
| GET/POST | `/api/v1/platform-connections` | 查询或新增加密的通用 RTMP 连接 |
| GET/PUT | `/api/v1/platform-connections/{id}` | 读取或更新平台连接（不返回密钥） |
| POST | `/api/v1/platform-connections/{id}/test` | 测试公网 RTMP 服务器可达性 |
| POST | `/api/v1/live-runs/preflight` | 服务端权威开播预检（不通过时不会创建运行记录） |
| POST | `/api/v1/live-runs` | 幂等创建持久化开播运行记录 |
| GET | `/api/v1/live-runs/{id}` | 查询运行记录和目标状态 |
| POST | `/api/v1/live-runs/{id}/start` | 启动媒体 supervisor，等待浏览器 WHIP 源并转推，或启动显式启用的测试源 |
| POST | `/api/v1/live-runs/{id}/stop` | 请求停止运行记录并回收 FFmpeg/SRS 推流进程 |

## /say 编排流程

1. 校验 session、文本 → 计时调用 Azure TTS 得到 mp3（记录 `tts_latency_ms`）。
2. 调用 LiveTalking `POST /human {sessionid, text, type:"echo"}` 驱动渲染。
3. LiveTalking 不可达（本机无 GPU / 未启动）→ 返回 `livetalking.degraded=true`，**不抛异常、不阻塞 TTS 验证**。

## 配置

**docker 部署**统一读项目根目录 `.env`（见根 `.env.example`），api 容器通过 compose 的 `env_file` 自动注入。关键项：

- `AZURE_SERVICE_KEY` / `AZURE_SERVICE_REGION`：Azure 语音凭据。
- `LIVETALKING_URL`：docker 内网 `http://livetalking:8010`；本地原生跑改 `http://localhost:8010`。
- `LIVETALKING_ENABLED=false`：完全跳过 LiveTalking 调用（不看降级日志）。
- `DATABASE_URL`：直播间控制台配置数据库；Docker Compose 默认连接 PostgreSQL。
- `PLATFORM_ENCRYPTION_KEY`：URL-safe Base64 编码的 32 字节主密钥，用于 AES-GCM 加密 RTMP 密钥。生产环境必须由 Secret Manager 注入。
- `LIVE_RUN_ALLOW_TEST_PATTERN`：是否允许服务端接受测试画面源，默认 `false`；只用于本地媒体链路联调，不能替代真实浏览器媒体网关。
- `MEDIA_SUPERVISOR_ENABLED`：是否启用进程隔离的 FFmpeg 媒体 supervisor，默认 `true`。
- `SRS_INTERNAL_RTMP_URL`：API 容器发布内部源流的 SRS 地址，Compose 默认 `rtmp://srs:1935/live`。
- `SRS_INTERNAL_API_URL`：supervisor 检测浏览器源流状态的 SRS API，Compose 默认 `http://srs:1985`。
- `SRS_PUBLIC_WHIP_PATH`：返回浏览器的同源 WHIP 路径，默认 `/rtc/v1/whip/`；Caddy 将其转发到 SRS。
- `SRS_CANDIDATE`：SRS WebRTC 对浏览器公布的 IP，部署时必须设置为浏览器可达地址。

API 容器启动时自动执行 `alembic upgrade head`。浏览器保存直播间时使用版本号做冲突检查，避免旧页面静默覆盖较新的配置。

通用 RTMP 连接将服务器地址与推流密钥分开保存，接口响应只包含密钥末四位。连接测试会拒绝内网、回环和保留地址，防止平台测试接口被用于 SSRF；测试通过仅代表服务器可达，不代表 OAuth、互动或电商权限已经授权。

开播运行记录会保存发布时的直播间配置快照和每个 RTMP 目标的加密凭据快照。服务端预检要求直播间已发布、配置版本一致、目标启用且最近测试通过、凭据可解密、输出为 RTMP / H.264，并且操作者确认地址来源合法。`browser_ingest` 使用服务端生成的不可预测流名和同源 WHIP 地址：supervisor 在 `starting` 状态等待 SRS 检测到浏览器最终画面，再为每个目标启动独立 FFmpeg；短时断流有恢复宽限期，目标进程退出按指数退避重试。`test_pattern` 仍须显式开启且只用于联调。停播或 API 重启会回收/标记未完成任务。

## 后续阶段

- 实时互动 Session 持久化：当前仍保持内存版，后续按独立任务处理；`live-runs` 只记录开播生命周期，不替代互动 Session。
- 实时状态：Redis（直播状态、播报队列）。
- 知识库：Qdrant（向量检索）、MinIO（音频/模型资产）。
- 媒体：SRS（RTMP/WebRTC 预览与推流）。
- AI：ASR（FunASR）、LLM（OpenAI-compatible）、声线克隆（CosyVoice）。
