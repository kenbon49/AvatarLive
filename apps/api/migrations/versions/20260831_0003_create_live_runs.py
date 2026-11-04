"""Create persistent live runs and publish targets.

Revision ID: 20260831_0003
Revises: 20260831_0002
Create Date: 2026-08-31 15:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0003"
down_revision = "20260831_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("request_id", sa.String(length=100), nullable=False),
        sa.Column("live_room_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("room_version", sa.Integer(), nullable=False),
        sa.Column("config_snapshot", sa.JSON(), nullable=False),
        sa.Column("media_source_kind", sa.String(length=30), nullable=False),
        sa.Column("media_source_id", sa.String(length=160), nullable=True),
        sa.Column("legal_source_confirmed", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["live_room_id"],
            ["live_rooms.id"],
            name=op.f("fk_live_runs_live_room_id_live_rooms"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_runs")),
        sa.UniqueConstraint("request_id", name=op.f("uq_live_runs_request_id")),
    )
    op.create_index(op.f("ix_live_runs_live_room_id"), "live_runs", ["live_room_id"], unique=False)
    op.create_index(op.f("ix_live_runs_request_id"), "live_runs", ["request_id"], unique=False)
    op.create_index(op.f("ix_live_runs_status"), "live_runs", ["status"], unique=False)

    op.create_table(
        "live_run_targets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("live_run_id", sa.String(length=36), nullable=False),
        sa.Column("platform_connection_id", sa.String(length=36), nullable=False),
        sa.Column("connection_version", sa.Integer(), nullable=False),
        sa.Column("connection_name", sa.String(length=120), nullable=False),
        sa.Column("platform_label", sa.String(length=80), nullable=False),
        sa.Column("server_url", sa.String(length=500), nullable=False),
        sa.Column("stream_key_ciphertext", sa.Text(), nullable=False),
        sa.Column("stream_key_last4", sa.String(length=4), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("process_pid", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["live_run_id"],
            ["live_runs.id"],
            name=op.f("fk_live_run_targets_live_run_id_live_runs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["platform_connection_id"],
            ["platform_connections.id"],
            name=op.f("fk_live_run_targets_platform_connection_id_platform_connections"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_run_targets")),
    )
    op.create_index(
        op.f("ix_live_run_targets_live_run_id"),
        "live_run_targets",
        ["live_run_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_live_run_targets_platform_connection_id"),
        "live_run_targets",
        ["platform_connection_id"],
        unique=False,
    )
    op.create_index(op.f("ix_live_run_targets_status"), "live_run_targets", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_live_run_targets_status"), table_name="live_run_targets")
    op.drop_index(
        op.f("ix_live_run_targets_platform_connection_id"),
        table_name="live_run_targets",
    )
    op.drop_index(op.f("ix_live_run_targets_live_run_id"), table_name="live_run_targets")
    op.drop_table("live_run_targets")
    op.drop_index(op.f("ix_live_runs_status"), table_name="live_runs")
    op.drop_index(op.f("ix_live_runs_request_id"), table_name="live_runs")
    op.drop_index(op.f("ix_live_runs_live_room_id"), table_name="live_runs")
    op.drop_table("live_runs")
