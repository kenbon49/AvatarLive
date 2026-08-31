"""Create encrypted platform connections.

Revision ID: 20260831_0002
Revises: 20260831_0001
Create Date: 2026-08-31 12:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0002"
down_revision = "20260831_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_connections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("platform_label", sa.String(length=80), nullable=False),
        sa.Column("server_url", sa.String(length=500), nullable=False),
        sa.Column("stream_key_ciphertext", sa.Text(), nullable=False),
        sa.Column("stream_key_last4", sa.String(length=4), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("test_status", sa.String(length=20), nullable=False),
        sa.Column("test_message", sa.String(length=500), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_platform_connections")),
    )
    op.create_index(
        op.f("ix_platform_connections_kind"),
        "platform_connections",
        ["kind"],
        unique=False,
    )
    op.create_index(
        op.f("ix_platform_connections_status"),
        "platform_connections",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_platform_connections_status"), table_name="platform_connections")
    op.drop_index(op.f("ix_platform_connections_kind"), table_name="platform_connections")
    op.drop_table("platform_connections")
