"""Add prepaid credit balances, immutable ledger entries, and API usage records."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260920_0010"
down_revision = "20260920_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("credit_balance", sa.BigInteger(), nullable=False, server_default="0"))
    op.create_table(
        "credit_ledger_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("counterparty_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", sa.BigInteger(), nullable=False),
        sa.Column("reference", sa.String(160), nullable=False, unique=True),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_credit_ledger_entries_user_id", "credit_ledger_entries", ["user_id"])
    op.create_index("ix_credit_ledger_entries_kind", "credit_ledger_entries", ["kind"])
    op.create_index("ix_credit_ledger_entries_created_at", "credit_ledger_entries", ["created_at"])
    op.create_table(
        "api_usages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("operation", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("request_units", sa.BigInteger(), nullable=False),
        sa.Column("credits", sa.BigInteger(), nullable=False),
        sa.Column("reference", sa.String(160), nullable=False, unique=True),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_api_usages_user_id", "api_usages", ["user_id"])
    op.create_index("ix_api_usages_operation", "api_usages", ["operation"])
    op.create_index("ix_api_usages_status", "api_usages", ["status"])
    op.create_index("ix_api_usages_created_at", "api_usages", ["created_at"])


def downgrade() -> None:
    op.drop_table("api_usages")
    op.drop_table("credit_ledger_entries")
    op.drop_column("users", "credit_balance")
