"""Create normalized inbound platform events."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260901_0006"
down_revision = "20260901_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_live_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("platform", sa.String(length=50), nullable=False),
        sa.Column("external_event_id", sa.String(length=200), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("live_room_id", sa.String(length=36), nullable=False),
        sa.Column("live_run_id", sa.String(length=36), nullable=True),
        sa.Column("actor_id", sa.String(length=200), nullable=True),
        sa.Column("actor_name", sa.String(length=200), nullable=True),
        sa.Column("actor_avatar_url", sa.String(length=1000), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["live_room_id"],
            ["live_rooms.id"],
            name=op.f("fk_platform_live_events_live_room_id_live_rooms"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["live_run_id"],
            ["live_runs.id"],
            name=op.f("fk_platform_live_events_live_run_id_live_runs"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_platform_live_events")),
        sa.UniqueConstraint(
            "platform",
            "live_room_id",
            "external_event_id",
            name="uq_platform_live_events_source_event",
        ),
    )
    op.create_index(op.f("ix_platform_live_events_event_type"), "platform_live_events", ["event_type"])
    op.create_index(op.f("ix_platform_live_events_live_room_id"), "platform_live_events", ["live_room_id"])
    op.create_index(op.f("ix_platform_live_events_live_run_id"), "platform_live_events", ["live_run_id"])
    op.create_index(op.f("ix_platform_live_events_platform"), "platform_live_events", ["platform"])
    op.create_index("ix_platform_live_events_room_received", "platform_live_events", ["live_room_id", "received_at"])


def downgrade() -> None:
    op.drop_index("ix_platform_live_events_room_received", table_name="platform_live_events")
    op.drop_index(op.f("ix_platform_live_events_platform"), table_name="platform_live_events")
    op.drop_index(op.f("ix_platform_live_events_live_run_id"), table_name="platform_live_events")
    op.drop_index(op.f("ix_platform_live_events_live_room_id"), table_name="platform_live_events")
    op.drop_index(op.f("ix_platform_live_events_event_type"), table_name="platform_live_events")
    op.drop_table("platform_live_events")
