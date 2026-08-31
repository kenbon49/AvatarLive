"""Create persistent live rooms.

Revision ID: 20260831_0001
Revises:
Create Date: 2026-08-31 10:40:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_rooms",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_rooms")),
    )
    op.create_index(op.f("ix_live_rooms_slug"), "live_rooms", ["slug"], unique=True)
    op.create_index(op.f("ix_live_rooms_status"), "live_rooms", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_live_rooms_status"), table_name="live_rooms")
    op.drop_index(op.f("ix_live_rooms_slug"), table_name="live_rooms")
    op.drop_table("live_rooms")
