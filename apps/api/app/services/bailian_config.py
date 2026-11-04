from hashlib import sha256
from urllib.parse import urlsplit

from ..security.settings_store import effective_api_value

DEFAULT_BAILIAN_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
OFFICIAL_HOSTS = {"dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com"}


def validate_bailian_base_url(value: str) -> str:
    try:
        url = urlsplit(value.strip())
        valid = (url.scheme == "https" and url.hostname in OFFICIAL_HOSTS and not url.username
                 and not url.password and url.port in {None, 443} and not url.query and not url.fragment
                 and url.path.rstrip("/") in {"", "/api/v1"})
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("请填写百炼官方 HTTPS 服务地址，例如 https://dashscope.aliyuncs.com/api/v1")
    return f"https://{url.hostname}/api/v1"


def active_bailian_configuration() -> tuple[str, str, str]:
    key = effective_api_value("bailian_tts_api_key").strip()
    base_url = validate_bailian_base_url(effective_api_value("bailian_tts_base_url").strip() or DEFAULT_BAILIAN_BASE_URL)
    fingerprint = sha256(f"{key}\0{base_url}".encode()).hexdigest() if key else ""
    return key, base_url, fingerprint
