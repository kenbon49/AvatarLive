"""Add accounts and keep legacy business records admin-owned until claimed."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260920_0008"
down_revision = "20260901_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_status", "users", ["status"])
    op.create_table("login_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_login_sessions_user_id", "login_sessions", ["user_id"])
    op.create_table("system_settings",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("encrypted_value", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table("setting_audit",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_setting_audit_key", "setting_audit", ["key"])
    for table in ("live_rooms", "platform_connections", "products"):
        op.add_column(table, sa.Column("owner_id", sa.String(36), nullable=True))
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])
        op.create_foreign_key(f"fk_{table}_owner_id_users", table, "users", ["owner_id"], ["id"], ondelete="RESTRICT")


def downgrade() -> None:
    for table in ("products", "platform_connections", "live_rooms"):
        op.drop_constraint(f"fk_{table}_owner_id_users", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_owner_id", table_name=table)
        op.drop_column(table, "owner_id")
    op.drop_table("setting_audit")
    op.drop_table("system_settings")
    op.drop_table("login_sessions")
    op.drop_table("users")
