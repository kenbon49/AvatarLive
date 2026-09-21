"""Add optional usernames while retaining email-based login compatibility."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260920_0009"
down_revision = "20260920_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(32), nullable=True))
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "username")
