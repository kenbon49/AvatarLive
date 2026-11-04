"""Add cost-based reservations, platform funding, and provider balance snapshots."""

from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20260923_0012"
down_revision = "20260923_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("credit_balance_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("reserved_balance_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.execute("UPDATE users SET credit_balance_micros = credit_balance * 10000")

    op.add_column("api_usages", sa.Column("reserved_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("api_usages", sa.Column("settled_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("api_usages", sa.Column("upstream_cost_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("api_usages", sa.Column("provider", sa.String(40), nullable=False, server_default=""))
    op.add_column("api_usages", sa.Column("model", sa.String(160), nullable=False, server_default=""))
    op.add_column("api_usages", sa.Column("provider_resource_id", sa.String(160), nullable=True))
    op.add_column("api_usages", sa.Column("pricing_version", sa.String(80), nullable=False, server_default=""))
    op.add_column("api_usages", sa.Column("pricing_time_band", sa.String(20), nullable=False, server_default=""))
    op.add_column("api_usages", sa.Column("input_cache_hit_tokens", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("api_usages", sa.Column("input_cache_miss_tokens", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("api_usages", sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("api_usages", sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_api_usages_provider_resource_id", "api_usages", ["provider_resource_id"])
    op.execute(
        "UPDATE api_usages SET settled_micros = credits * 10000, "
        "pricing_version = 'legacy-fixed-v1'"
    )

    op.add_column("credit_ledger_entries", sa.Column("amount_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("credit_ledger_entries", sa.Column("balance_after_micros", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("credit_ledger_entries", sa.Column("usage_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_credit_ledger_entries_usage_id", "credit_ledger_entries", "api_usages", ["usage_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_credit_ledger_entries_usage_id", "credit_ledger_entries", ["usage_id"])
    op.execute(
        "UPDATE credit_ledger_entries SET amount_micros = amount * 10000, "
        "balance_after_micros = balance_after * 10000"
    )

    op.create_table(
        "platform_funding_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("available_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_funded_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_allocated_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("total_returned_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    account = sa.table(
        "platform_funding_accounts",
        sa.column("id", sa.String),
        sa.column("available_micros", sa.BigInteger),
        sa.column("total_funded_micros", sa.BigInteger),
        sa.column("total_allocated_micros", sa.BigInteger),
        sa.column("total_returned_micros", sa.BigInteger),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(account, [{
        "id": "primary",
        "available_micros": 0,
        "total_funded_micros": 0,
        "total_allocated_micros": 0,
        "total_returned_micros": 0,
        "updated_at": datetime.now(timezone.utc),
    }])
    op.create_table(
        "platform_funding_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("platform_funding_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("target_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("amount_micros", sa.BigInteger(), nullable=False),
        sa.Column("balance_after_micros", sa.BigInteger(), nullable=False),
        sa.Column("reference", sa.String(160), nullable=False, unique=True),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("account_id", "target_user_id", "kind", "created_at"):
        op.create_index(f"ix_platform_funding_entries_{column}", "platform_funding_entries", [column])

    op.create_table(
        "provider_balance_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("currency", sa.String(12), nullable=False),
        sa.Column("available_micros", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.String(300), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("provider", "status", "fetched_at"):
        op.create_index(f"ix_provider_balance_snapshots_{column}", "provider_balance_snapshots", [column])


def downgrade() -> None:
    op.drop_table("provider_balance_snapshots")
    op.drop_table("platform_funding_entries")
    op.drop_table("platform_funding_accounts")
    op.drop_index("ix_credit_ledger_entries_usage_id", table_name="credit_ledger_entries")
    op.drop_constraint("fk_credit_ledger_entries_usage_id", "credit_ledger_entries", type_="foreignkey")
    op.drop_column("credit_ledger_entries", "usage_id")
    op.drop_column("credit_ledger_entries", "balance_after_micros")
    op.drop_column("credit_ledger_entries", "amount_micros")
    op.drop_index("ix_api_usages_provider_resource_id", table_name="api_usages")
    for column in (
        "settled_at", "output_tokens", "input_cache_miss_tokens", "input_cache_hit_tokens",
        "pricing_time_band", "pricing_version", "provider_resource_id", "model", "provider",
        "upstream_cost_micros", "settled_micros", "reserved_micros",
    ):
        op.drop_column("api_usages", column)
    op.drop_column("users", "reserved_balance_micros")
    op.drop_column("users", "credit_balance_micros")
