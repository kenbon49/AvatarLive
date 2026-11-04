"""Track the internal source FFmpeg process for live runs.

Revision ID: 20260831_0004
Revises: 20260831_0003
Create Date: 2026-08-31 16:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260831_0004"
down_revision = "20260831_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("live_runs", sa.Column("source_process_pid", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("live_runs", "source_process_pid")
