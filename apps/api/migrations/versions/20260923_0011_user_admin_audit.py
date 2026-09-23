"""Add audit records for administrator actions on user accounts."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260923_0011"
down_revision = "20260920_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_admin_audit",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "target_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_admin_audit_target_user_id", "user_admin_audit", ["target_user_id"])
    op.create_index("ix_user_admin_audit_actor_id", "user_admin_audit", ["actor_id"])
    op.create_index("ix_user_admin_audit_action", "user_admin_audit", ["action"])
    op.create_index("ix_user_admin_audit_created_at", "user_admin_audit", ["created_at"])


def downgrade() -> None:
    op.drop_table("user_admin_audit")
