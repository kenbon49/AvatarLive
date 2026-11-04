"""Track duration of browser window playback per live room."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260928_0014"
down_revision = "20260928_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_room_playback_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("live_room_id", sa.String(36), sa.ForeignKey("live_rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False, server_default="0"),
    )
    op.create_index("ix_live_room_playback_sessions_live_room_id", "live_room_playback_sessions", ["live_room_id"])


def downgrade() -> None:
    op.drop_index("ix_live_room_playback_sessions_live_room_id", table_name="live_room_playback_sessions")
    op.drop_table("live_room_playback_sessions")
