"""Safe public-network reachability checks for manually configured RTMP servers."""

from __future__ import annotations

import ipaddress
import socket
import ssl
from urllib.parse import urlsplit


class RtmpProbeError(RuntimeError):
    """A user-safe RTMP reachability failure."""


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return bool(address.is_global)


def probe_rtmp_endpoint(server_url: str, timeout: float = 4.0) -> str:
    parsed = urlsplit(server_url)
    host = parsed.hostname
    if not host:
        raise RtmpProbeError("RTMP 地址缺少主机名")
    port = parsed.port or (443 if parsed.scheme == "rtmps" else 1935)
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise RtmpProbeError("无法解析 RTMP 服务器域名") from exc
    if not addresses:
        raise RtmpProbeError("RTMP 服务器没有可用地址")
    if any(not _is_public_address(item[4][0]) for item in addresses):
        raise RtmpProbeError("为防止访问内网资源，只允许测试公网 RTMP 地址")

    last_error: OSError | None = None
    for family, socktype, protocol, _, sockaddr in addresses:
        raw_socket = socket.socket(family, socktype, protocol)
        raw_socket.settimeout(timeout)
        try:
            raw_socket.connect(sockaddr)
            if parsed.scheme == "rtmps":
                with ssl.create_default_context().wrap_socket(raw_socket, server_hostname=host):
                    pass
            else:
                raw_socket.close()
            return f"服务器可达（{host}:{port}）；推流密钥将在正式推流时校验"
        except (OSError, ssl.SSLError) as exc:
            last_error = exc
            raw_socket.close()
    raise RtmpProbeError(f"无法连接 RTMP 服务器 {host}:{port}") from last_error
