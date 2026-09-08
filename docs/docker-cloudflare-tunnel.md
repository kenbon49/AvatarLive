# Docker 前端的 Cloudflare Tunnel

本项目使用现有的远程管理型 Tunnel，不创建或修改 Cloudflare DNS：

| 项目 | 值 |
| --- | --- |
| Tunnel | `paperview-avator-windows` |
| Tunnel ID | `94d3b6e1-3ea3-43d9-9026-9c922040d65d` |
| Public Hostname | `avator.ipaperview.com` |
| Origin Service | `http://127.0.0.1:3000` |

## 架构

`cloudflared` 作为独立 Compose 容器运行，但与 `web` 共享网络命名空间。因此 Cloudflare 远程配置中的 `127.0.0.1:3000` 会访问 Next.js 容器，不需要把 3000 端口发布到宿主机。

Connector 固定使用 IPv4 连接 Cloudflare Edge，并关闭容器内自动更新。镜像版本由 Compose 的 `CLOUDFLARED_VERSION` 统一控制，升级时重新部署容器即可。

```text
Cloudflare Edge
  -> cloudflared container
  -> shared web network namespace
  -> http://127.0.0.1:3000
  -> Next.js
  -> api:8000 / srs:1985
```

Tunnel token 通过 Compose secret 只读挂载到 `/run/secrets/cloudflare_tunnel_token`。它不会进入 Git、Dockerfile、镜像层、容器环境变量或启动命令。部署脚本会让 `cloudflared` 使用该文件的宿主机 UID/GID，兼容本地 Compose 保留 bind mount 文件权限的行为。

## 首次配置

不要把 Tunnel token 发到聊天中，也不要直接放在命令行参数中。

1. 在自己的浏览器里打开 Cloudflare Zero Trust。
2. 进入 `Networks -> Tunnels -> paperview-avator-windows`。
3. 选择添加 Connector，复制页面提供的 Tunnel token。
4. 在项目目录的交互式终端运行：

```bash
./scripts/configure-cloudflare-tunnel-token.sh
```

5. 在脚本的隐藏输入提示中粘贴 token，然后运行：

```bash
./scripts/deploy-full.sh
```

只要 `secrets/cloudflare-tunnel-token` 存在且非空，部署脚本就会自动启用 Compose 的 `tunnel` profile，随后每次 Web 服务部署都会同时启动或恢复 `cloudflared`。

## 验证

以下命令不会显示 token：

```bash
docker compose -f infra/docker-compose.yml --env-file .env --profile tunnel ps cloudflared web
docker compose -f infra/docker-compose.yml --env-file .env --profile tunnel logs --tail 50 cloudflared
curl -sS -o /dev/null -w 'public_http=%{http_code}\n' https://avator.ipaperview.com/health
```

期望结果：

- `web` 显示 `healthy`。
- `cloudflared` 保持 `Up`，日志中出现已注册连接，不出现 origin connection refused。
- 公网 `/health` 返回 HTTP 200。

## 现有 Windows Replica

当前 Tunnel 可能仍连接一个 Windows replica。如果该 Windows 主机的 `127.0.0.1:3000` 没有应用，它会返回 502。Linux/Docker Connector 验证成功后，应在 Windows 管理员终端停止旧的 `cloudflared` 服务，或者确保 Windows 的 3000 服务持续可用；否则同一 Tunnel 的多个 replica 可能产生间歇性 502。

不要从项目脚本删除 Tunnel、Public Hostname 或 DNS，也不要把 Windows Connector token 复制到仓库。需要轮换 token 时，应在 Cloudflare 页面操作，并重新运行安全配置脚本。
