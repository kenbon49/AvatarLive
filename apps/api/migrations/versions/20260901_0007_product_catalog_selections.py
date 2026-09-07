"""Split reusable products from live-room selections."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260901_0007"
down_revision = "20260901_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_type", sa.String(length=30), nullable=False),
        sa.Column("platform", sa.String(length=50), nullable=True),
        sa.Column("platform_account_id", sa.String(length=36), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("sku", sa.String(length=160), nullable=False),
        sa.Column("image_url", sa.String(length=1000), nullable=True),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("original_price", sa.Float(), nullable=True),
        sa.Column("selling_points", sa.JSON(), nullable=False),
        sa.Column("stock_message", sa.String(length=500), nullable=False),
        sa.Column("after_sales", sa.Text(), nullable=False),
        sa.Column("platform_product_id", sa.String(length=200), nullable=False),
        sa.Column("risk_words", sa.JSON(), nullable=False),
        sa.Column("platform_status", sa.String(length=30), nullable=False),
        sa.Column("raw_snapshot", sa.JSON(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
        sa.UniqueConstraint(
            "platform",
            "platform_account_id",
            "platform_product_id",
            name="uq_products_platform_account_product",
        ),
    )
    op.create_index(op.f("ix_products_name"), "products", ["name"])
    op.create_index(op.f("ix_products_platform"), "products", ["platform"])
    op.create_index(op.f("ix_products_platform_account_id"), "products", ["platform_account_id"])
    op.create_index(op.f("ix_products_source_type"), "products", ["source_type"])

    op.create_table(
        "live_room_product_selections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("live_room_id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("card_mode", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["live_room_id"],
            ["live_rooms.id"],
            name=op.f("fk_live_room_product_selections_live_room_id_live_rooms"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_live_room_product_selections_product_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_room_product_selections")),
        sa.UniqueConstraint(
            "live_room_id",
            "product_id",
            name="uq_live_room_product_selections_room_product",
        ),
    )
    op.create_index(
        op.f("ix_live_room_product_selections_live_room_id"),
        "live_room_product_selections",
        ["live_room_id"],
    )
    op.create_index(
        op.f("ix_live_room_product_selections_product_id"),
        "live_room_product_selections",
        ["product_id"],
    )

    # Existing room-scoped rows become reusable products plus one room selection.
    op.execute(
        """
        INSERT INTO products (
            id, source_type, platform, platform_account_id, name, sku, image_url,
            price, original_price, selling_points, stock_message, after_sales,
            platform_product_id, risk_words, platform_status, raw_snapshot,
            last_synced_at, created_at, updated_at
        )
        SELECT
            id, 'self_built', NULL, NULL, name, sku, image_url,
            price, original_price, selling_points, stock_message, after_sales,
            platform_product_id, risk_words, 'local', '{}', NULL, created_at, updated_at
        FROM live_room_products
        """
    )
    op.execute(
        """
        INSERT INTO live_room_product_selections (
            id, live_room_id, product_id, sort_order, enabled, card_mode, created_at, updated_at
        )
        SELECT
            id, live_room_id, id,
            ROW_NUMBER() OVER (PARTITION BY live_room_id ORDER BY created_at, id) - 1,
            TRUE, 'visual', created_at, updated_at
        FROM live_room_products
        """
    )

    op.add_column("live_room_script_library", sa.Column("product_id", sa.String(length=36), nullable=True))
    op.create_index(
        op.f("ix_live_room_script_library_product_id"),
        "live_room_script_library",
        ["product_id"],
    )
    op.create_foreign_key(
        op.f("fk_live_room_script_library_product_id_products"),
        "live_room_script_library",
        "products",
        ["product_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_index(op.f("ix_live_room_products_live_room_id"), table_name="live_room_products")
    op.drop_table("live_room_products")


def downgrade() -> None:
    op.create_table(
        "live_room_products",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("live_room_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("sku", sa.String(length=160), nullable=False),
        sa.Column("image_url", sa.String(length=1000), nullable=True),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("original_price", sa.Float(), nullable=True),
        sa.Column("selling_points", sa.JSON(), nullable=False),
        sa.Column("stock_message", sa.String(length=500), nullable=False),
        sa.Column("after_sales", sa.Text(), nullable=False),
        sa.Column("platform_product_id", sa.String(length=200), nullable=False),
        sa.Column("risk_words", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["live_room_id"],
            ["live_rooms.id"],
            name=op.f("fk_live_room_products_live_room_id_live_rooms"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_room_products")),
    )
    op.create_index(op.f("ix_live_room_products_live_room_id"), "live_room_products", ["live_room_id"])
    op.execute(
        """
        INSERT INTO live_room_products (
            id, live_room_id, name, sku, image_url, price, original_price,
            selling_points, stock_message, after_sales, platform_product_id,
            risk_words, created_at, updated_at
        )
        SELECT
            selection.id, selection.live_room_id, product.name, product.sku,
            product.image_url, product.price, product.original_price,
            product.selling_points, product.stock_message, product.after_sales,
            product.platform_product_id, product.risk_words,
            selection.created_at, selection.updated_at
        FROM live_room_product_selections AS selection
        JOIN products AS product ON product.id = selection.product_id
        """
    )

    op.drop_constraint(
        op.f("fk_live_room_script_library_product_id_products"),
        "live_room_script_library",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_live_room_script_library_product_id"), table_name="live_room_script_library")
    op.drop_column("live_room_script_library", "product_id")
    op.drop_index(op.f("ix_live_room_product_selections_product_id"), table_name="live_room_product_selections")
    op.drop_index(op.f("ix_live_room_product_selections_live_room_id"), table_name="live_room_product_selections")
    op.drop_table("live_room_product_selections")
    op.drop_index(op.f("ix_products_source_type"), table_name="products")
    op.drop_index(op.f("ix_products_platform_account_id"), table_name="products")
    op.drop_index(op.f("ix_products_platform"), table_name="products")
    op.drop_index(op.f("ix_products_name"), table_name="products")
    op.drop_table("products")
