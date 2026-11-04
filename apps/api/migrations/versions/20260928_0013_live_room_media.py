"""Store live-room images and videos separately from configuration JSON."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260928_0013"
down_revision = "20260923_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_room_media",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("content_type", sa.String(80), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_live_room_media_owner_id", "live_room_media", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_live_room_media_owner_id", table_name="live_room_media")
    op.drop_table("live_room_media")
