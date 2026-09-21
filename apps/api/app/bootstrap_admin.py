"""Create the first administrator in the API's database exactly once."""

from __future__ import annotations

import argparse
from getpass import getpass
import os
from pathlib import Path
import secrets
import stat

from email_validator import EmailNotValidError, validate_email

from sqlalchemy import select, update

from .db.session import SessionLocal
from .models.account import User
from .models.live_library import Product
from .models.live_room import LiveRoom
from .models.platform_connection import PlatformConnection
from .security.accounts import hash_password


def write_generated_credentials(path: Path, email: str, password: str) -> None:
    if not path.is_absolute() or path.parent.resolve(strict=True) != path.parent:
        raise ValueError("凭据文件必须使用无符号链接的绝对路径")
    if not path.parent.is_dir() or stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        raise ValueError("凭据目录必须是只有当前用户可访问的目录")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(f"管理员邮箱: {email}\n初始密码: {password}\n")
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first administrator")
    parser.add_argument("--email", help="administrator email for generated credentials")
    parser.add_argument("--username", help="optional administrator login username")
    parser.add_argument("--credentials-file", type=Path, help="new private file for a generated password")
    parser.add_argument(
        "--if-missing",
        action="store_true",
        help="exit successfully when an administrator already exists",
    )
    args = parser.parse_args()
    if bool(args.email) != bool(args.credentials_file):
        parser.error("--email and --credentials-file must be provided together")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.role == "admin")):
            if args.if_missing:
                print("管理员已存在；跳过首次账号创建。")
                return
            raise SystemExit("管理员已存在；不会通过此命令创建第二个管理员")
        try:
            email = validate_email((args.email or input("管理员邮箱: ")).strip(), check_deliverability=False).normalized.lower()
        except EmailNotValidError as exc:
            raise SystemExit("管理员邮箱格式无效") from exc
        if args.credentials_file:
            password = secrets.token_urlsafe(36)
        else:
            password = getpass("管理员密码（至少 12 位）: ")
            if password != getpass("再次输入密码: "):
                raise SystemExit("两次密码不一致")
        if db.scalar(select(User.id).where(User.email == email)):
            raise SystemExit("邮箱已被注册")
        try:
            password_hash = hash_password(password)
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
        credentials_written = False
        try:
            if args.credentials_file:
                write_generated_credentials(args.credentials_file, email, password)
                credentials_written = True
            admin = User(email=email, username=args.username, password_hash=password_hash, role="admin", status="approved")
            db.add(admin)
            db.flush()
            for model in (LiveRoom, Product, PlatformConnection):
                db.execute(update(model).where(model.owner_id.is_(None)).values(owner_id=admin.id))
            db.commit()
        except BaseException:
            db.rollback()
            if credentials_written:
                args.credentials_file.unlink(missing_ok=True)
            raise
        print("管理员已创建；现有直播间、商品和推流连接已归属该账号。")
        if args.credentials_file:
            print(f"登录凭据仅保存在 {args.credentials_file}，首次登录后请妥善转存并删除该文件。")


if __name__ == "__main__":
    main()
