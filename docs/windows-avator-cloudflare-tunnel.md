# Windows `avator.ipaperview.com` Cloudflare Tunnel 部署手册

> 更新日期：2026-08-10
>
> 面向对象：在目标 Windows 机器上执行安装和验证的用户或 AI Agent。
>
> 目标：将 `https://avator.ipaperview.com` 安全地转发到该 Windows 主机的 `http://127.0.0.1:3000`。

## 1. Cloudflare 端已完成的配置

以下资源已经创建，不要在 Windows 上重复创建 Tunnel、DNS 或 Public Hostname：

| 项目 | 当前值 |
|---|---|
| Tunnel 名称 | `paperview-avator-windows` |
| Tunnel ID | `94d3b6e1-3ea3-43d9-9026-9c922040d65d` |
| 配置类型 | Cloudflare 远程管理型（`config_src=cloudflare`） |
| Public Hostname | `avator.ipaperview.com` |
| Origin Service | `http://127.0.0.1:3000` |
| 默认回退规则 | `http_status:404` |
| DNS | Proxied CNAME 指向 `94d3b6e1-3ea3-43d9-9026-9c922040d65d.cfargotunnel.com` |
| Connector 状态 | Windows 安装前为 `Down`（没有常驻 Connector），这是预期状态 |

域名使用的是 `avator`，不是 `avatar`。Windows 端不得自行纠正拼写。

Cloudflare 端已经用临时 3000 测试页完成一次 HTTPS 端到端验证；测试 Connector 和测试页随后均已关闭。Windows 上线前没有常驻 Connector。

目标链路为：

```text
用户浏览器或 API Client
  -> https://avator.ipaperview.com
  -> Cloudflare Edge
  -> paperview-avator-windows Tunnel
  -> Windows cloudflared Service
  -> http://127.0.0.1:3000
```

## 2. Agent 必须遵守的边界

1. 不运行 `cloudflared tunnel login`、`cloudflared tunnel create` 或 `cloudflared tunnel route dns`；Cloudflare 端已经配置完成。
2. 不复制 Mac 上 `litellm-proxy` 的配置、Tunnel JSON 或 Token。
3. 不把 Tunnel Token 写入仓库、脚本、日志、聊天消息、截图或本文件。
4. 不要求用户把 Tunnel Token 发到聊天中。到 Token 安装步骤时，必须让用户在 AI 工具之外手工粘贴 Cloudflare 提供的完整命令。
5. 不开放 Windows 入站 3000 端口，不做路由器端口映射；Tunnel 只需要出站连接。
6. 如果发现 Windows 已有名为 `cloudflared` 的服务，不卸载、不覆盖，先暂停并让用户确认它是否承载其他 Tunnel。
7. 不删除 Cloudflare Tunnel 或 DNS。停止/卸载 Windows Connector 不等于删除 Cloudflare 端资源。

## 3. 第一步：确认 Windows 上的 3000 服务

在普通 PowerShell 中执行：

```powershell
$AvatorOriginUrl = 'http://127.0.0.1:3000'

Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess

curl.exe --max-time 10 -sS -o NUL `
  -w "local_http_status=%{http_code}`n" `
  $AvatorOriginUrl
```

继续安装前必须满足：

- Windows 主机存在 3000 监听。
- `curl.exe` 能获得 HTTP 状态码。`200`、`301`、`302`、`401` 或 `404` 都说明 TCP/HTTP 链路可用；`000` 表示本地服务不可达。
- 必须从 Windows PowerShell 访问成功，只在 WSL 或 Docker 容器内部成功还不够。

如果服务运行在 Docker Desktop，至少要把容器端口发布到 Windows 主机，例如：

```powershell
docker run --publish 127.0.0.1:3000:3000 your-image
```

如果容器已经存在，使用下面的命令检查其端口发布情况：

```powershell
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"
```

如果应用运行在 WSL，先确保 `curl.exe http://127.0.0.1:3000/` 在 Windows 侧成功。不要让 cloudflared 依赖只在 WSL 内可解析的地址。

## 4. 第二步：安装 cloudflared

用“以管理员身份运行”的 PowerShell 执行：

```powershell
winget install --id Cloudflare.cloudflared --exact `
  --accept-package-agreements `
  --accept-source-agreements
```

关闭并重新打开 PowerShell，然后验证：

```powershell
Get-Command cloudflared.exe
cloudflared.exe --version
```

检查是否已有 cloudflared Windows 服务：

```powershell
$ExistingCloudflaredService = Get-Service cloudflared -ErrorAction SilentlyContinue
$ExistingCloudflaredService | Select-Object Name, Status, StartType
```

处理规则：

- 没有输出：可以继续安装本 Tunnel Connector。
- 已有服务：立即暂停。不要运行新的 `service install`，不要卸载原服务；让用户确认原服务用途。

## 5. 第三步：由用户手工安装 Connector Token

Tunnel Token 是运行 Connector 的机密凭据。本步骤不能由 AI 把 Token 放进工具调用或聊天记录。

用户在自己的浏览器中执行：

1. 打开 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)。
2. 进入 `Networks -> Tunnels`；新版界面可能显示为 `Networks -> Connectors -> Cloudflare Tunnels`。
3. 打开 `paperview-avator-windows`。
4. 选择添加/安装 Connector，平台选择 `Windows`。
5. 复制 Cloudflare 生成的完整安装命令。命令形态类似：

```text
cloudflared.exe service install <TUNNEL_TOKEN>
```

6. 打开一个新的“管理员命令提示符（cmd.exe）”，由用户本人粘贴并执行完整命令。
7. 命令成功后关闭该命令提示符窗口，不把命令或 Token 发回 AI。

AI Agent 在这一步必须暂停，只询问“安装命令是否成功”，不能询问 Token 内容。

如果 Token 曾经出现在聊天、仓库、截图或可共享日志中，应立即在 Cloudflare Tunnel 页面轮换 Token，再重新安装 Connector。

## 6. 第四步：验证 Windows 服务

用户确认安装命令成功后，在管理员 PowerShell 中执行：

```powershell
Get-Service cloudflared |
  Select-Object Name, Status, StartType

Get-CimInstance Win32_Service -Filter "Name='cloudflared'" |
  Select-Object Name, State, StartMode
```

期望结果：

- `Status` 或 `State` 为 `Running`。
- `StartType` 或 `StartMode` 为自动启动。

如果服务存在但没有运行：

```powershell
Start-Service cloudflared
Get-Service cloudflared
```

不要输出 Windows Service 的完整启动命令或 `PathName`，其中可能包含 Tunnel Token。

## 7. 第五步：验证 Tunnel 与域名

先再次确认本地 Origin：

```powershell
curl.exe --max-time 10 -sS -o NUL `
  -w "local_http_status=%{http_code}`n" `
  http://127.0.0.1:3000/
```

检查 DNS：

```powershell
Resolve-DnsName avator.ipaperview.com
```

如果本机此前查询过尚未创建的域名，可能仍保留 DNS 负缓存。可以清理后再查询公共解析器：

```powershell
Clear-DnsClientCache
Resolve-DnsName avator.ipaperview.com -Server 1.1.1.1
```

检查公网访问：

```powershell
curl.exe --max-time 30 -sS -o NUL `
  -w "public_http_status=%{http_code} total_seconds=%{time_total}`n" `
  https://avator.ipaperview.com/
```

最后在 Cloudflare Tunnel 页面确认：

- `paperview-avator-windows` 状态从 `Down` 变为 `Healthy`。
- 至少出现 1 个 Windows Connector。
- Public Hostname 仍是 `avator.ipaperview.com`。
- Service 仍是 `http://127.0.0.1:3000`。

浏览器最终访问地址：

```text
https://avator.ipaperview.com
```

## 8. 防火墙和网络要求

Cloudflare Tunnel 使用出站连接，不需要开放任何公网入站端口。

建议允许 `cloudflared.exe` 出站访问：

- UDP `7844`，优先用于 QUIC。
- TCP `7844`，QUIC 不可用时用于 HTTP/2 Tunnel。
- TCP `443`，用于 Cloudflare API、更新和相关控制连接。

可以用下面的命令检查 TCP 7844：

```powershell
Test-NetConnection region1.v2.argotunnel.com -Port 7844
Test-NetConnection region2.v2.argotunnel.com -Port 7844
```

不要创建 Windows 入站 3000 防火墙规则，也不要把 3000 暴露给局域网或公网。

## 9. 常见故障

### 9.1 公网返回 Cloudflare 1033

含义：DNS/Tunnel 映射存在，但没有可用 Connector。

检查：

```powershell
Get-Service cloudflared
Test-NetConnection region1.v2.argotunnel.com -Port 7844
```

然后在 Cloudflare 页面确认 Tunnel 是否为 `Healthy`。如果 Token 被轮换，需要使用新的安装命令重新安装 Connector。

### 9.2 公网返回 502 Bad Gateway

含义：Connector 在线，但 cloudflared 访问不到 `127.0.0.1:3000`。

检查：

```powershell
curl.exe -v --max-time 10 http://127.0.0.1:3000/
Get-NetTCPConnection -State Listen -LocalPort 3000
```

常见原因：

- 应用没有启动。
- Docker 没有发布 3000 端口。
- 服务只存在于 WSL 网络中，Windows 主机无法访问。
- 应用只监听了错误的端口。

### 9.3 公网返回 404

如果响应内容来自你的 3000 应用，说明 Tunnel 已正常，问题是应用没有 `/` 路由。改用实际业务路径验证。

如果响应是 Cloudflare Tunnel 的固定 404，检查 Public Hostname 是否准确为 `avator.ipaperview.com`。

### 9.4 本地正常，但公网访问超时

检查企业网络、杀毒软件或 Windows 防火墙是否阻止 `cloudflared.exe` 的出站 `7844/443`。不要通过开放入站 3000 来解决。

### 9.5 cloudflared 服务已存在

不要覆盖或卸载。记录下面的非敏感信息并让用户确认：

```powershell
Get-Service cloudflared |
  Select-Object Name, Status, StartType
```

同一台机器可以让一个 Tunnel 配置多个 Public Hostname，但不能在不了解旧服务用途时覆盖其 Token。

## 10. 公开访问与 Access 保护

当前只创建了 Tunnel 和 Public Hostname，没有额外创建 Cloudflare Access Policy。Windows Connector 上线后，域名默认可从公网访问。

至少满足以下一项：

- 3000 应用自身有可靠的身份认证和授权。
- 在 Cloudflare Zero Trust 的 `Access -> Applications` 中为 `avator.ipaperview.com` 创建 Self-hosted Application 和 Allow Policy。
- 机器到机器调用使用 Cloudflare Access Service Token。

不要把 Cloudflare Access 当作应用内部权限校验的完全替代品。

## 11. 停止与回滚

临时停止 Windows Connector：

```powershell
Stop-Service cloudflared
Get-Service cloudflared
```

恢复：

```powershell
Start-Service cloudflared
```

只有用户明确确认这台机器不再运行任何 Cloudflare Tunnel 时，才能在管理员命令提示符中卸载服务：

```text
cloudflared.exe service uninstall
```

卸载 Windows 服务不会自动删除 Cloudflare 端的 Tunnel、Public Hostname 或 DNS。删除这些云端资源属于破坏性操作，AI Agent 必须单独获得用户确认。

## 12. 完成报告模板

Windows AI Agent 完成后只报告以下非敏感信息：

```text
Origin http://127.0.0.1:3000: <HTTP 状态码>
cloudflared version: <版本>
Windows service: <Running/Stopped>
Service start mode: <Auto/Manual>
Tunnel dashboard status: <Healthy/Inactive/Down>
DNS avator.ipaperview.com: <成功/失败>
Public HTTPS status: <HTTP 状态码>
Public request total time: <秒>
```

报告中不得包含 Tunnel Token、完整 Windows Service 启动命令、凭据文件内容或用户账号信息。
