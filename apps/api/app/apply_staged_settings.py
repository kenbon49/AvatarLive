"""Apply encrypted deployment settings to an explicit env file, then restart services.

Run only from a trusted host with database access. Does not edit the immutable
PLATFORM_ENCRYPTION_KEY, which protects the stored values themselves.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from dotenv import set_key

from .db.session import SessionLocal
from .security.settings_store import SETTING_FIELDS, stored_value


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply staged deployment configuration")
    parser.add_argument("--env-file", required=True, type=Path, help="existing, explicit .env path")
    parser.add_argument("--apply", action="store_true", help="write values; without this flag only validate")
    args = parser.parse_args()
    if args.env_file.is_symlink():
        parser.error("env file cannot be a symlink")
    path = args.env_file.resolve(strict=True)
    if not path.is_file():
        parser.error("env file must be an existing regular file, not a symlink")
    with SessionLocal() as db:
        pending = {
            name.upper(): stored_value(db, name)
            for name, (_, _, mode) in SETTING_FIELDS.items() if mode == "deployment"
        }
    pending = {name: value for name, value in pending.items() if value is not None}
    print(f"已找到 {len(pending)} 项管理端保存的部署配置，目标为 {path}。不会输出任何配置值。")
    if not args.apply:
        print("复核目标文件后，加 --apply 应用；数据库地址还须核对 Compose 环境覆盖与数据迁移。")
        return
    os.chmod(path, 0o600)
    for name, value in pending.items():
        set_key(str(path), name, value, quote_mode="always")
    os.chmod(path, 0o600)
    print("环境文件已更新；请由部署人员重启涉及的服务并验证健康检查。")


if __name__ == "__main__":
    main()
