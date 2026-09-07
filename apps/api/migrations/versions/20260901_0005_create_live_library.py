"""Create room-scoped products and script library."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260901_0005"
down_revision = "20260831_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_room_products")),
        sa.ForeignKeyConstraint(["live_room_id"], ["live_rooms.id"], name=op.f("fk_live_room_products_live_room_id_live_rooms"), ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_live_room_products_live_room_id"), "live_room_products", ["live_room_id"])
    op.create_table(
        "live_room_script_library",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("live_room_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("duration", sa.String(length=20), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_room_script_library")),
        sa.ForeignKeyConstraint(["live_room_id"], ["live_rooms.id"], name=op.f("fk_live_room_script_library_live_room_id_live_rooms"), ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_live_room_script_library_live_room_id"), "live_room_script_library", ["live_room_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_live_room_script_library_live_room_id"), table_name="live_room_script_library")
    op.drop_table("live_room_script_library")
    op.drop_index(op.f("ix_live_room_products_live_room_id"), table_name="live_room_products")
    op.drop_table("live_room_products")
