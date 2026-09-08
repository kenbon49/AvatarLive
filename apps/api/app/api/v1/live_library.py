"""Product-catalog, room-selection, and saved-script APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...models.live_library import LiveRoomProductSelection, LiveRoomScriptLibrary, Product, utc_now
from ...repositories.live_rooms import get_live_room
from ...schemas.live_library import (
    LiveRoomProductCreate,
    LiveRoomProductResponse,
    LiveRoomProductSelectionCreate,
    LiveRoomProductSelectionOrder,
    LiveRoomProductUpdate,
    LiveRoomScriptCreate,
    LiveRoomScriptResponse,
    LiveRoomScriptUpdate,
    ProductCreate,
    ProductResponse,
    ProductSourceType,
)

router = APIRouter(tags=["live library"])


def require_room(db: Session, room_id: str):
    room = get_live_room(db, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="live room not found")
    return room


def require_product(db: Session, product_id: str) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="product not found")
    return product


def selection_response(product: Product, selection: LiveRoomProductSelection) -> dict:
    return {
        **ProductResponse.model_validate(product).model_dump(),
        "live_room_id": selection.live_room_id,
        "selection_id": selection.id,
        "sort_order": selection.sort_order,
        "enabled": selection.enabled,
        "card_mode": selection.card_mode,
    }


def selected_products(db: Session, room_id: str) -> list[dict]:
    rows = db.execute(
        select(Product, LiveRoomProductSelection)
        .join(LiveRoomProductSelection, LiveRoomProductSelection.product_id == Product.id)
        .where(LiveRoomProductSelection.live_room_id == room_id)
        .order_by(LiveRoomProductSelection.sort_order.asc(), LiveRoomProductSelection.created_at.asc())
    ).all()
    return [selection_response(product, selection) for product, selection in rows]


def next_sort_order(db: Session, room_id: str) -> int:
    current = db.scalar(
        select(func.max(LiveRoomProductSelection.sort_order)).where(
            LiveRoomProductSelection.live_room_id == room_id
        )
    )
    return (current if current is not None else -1) + 1


@router.get("/products", response_model=list[ProductResponse], response_model_exclude_none=True)
def list_catalog_products(
    query: str = Query(default="", max_length=200),
    source_type: ProductSourceType | None = Query(default=None, alias="sourceType"),
    has_scripts: bool = Query(default=False, alias="hasScripts"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    statement = select(Product)
    if source_type is not None:
        statement = statement.where(Product.source_type == source_type)
    if query.strip():
        pattern = f"%{query.strip()}%"
        statement = statement.where(or_(Product.name.ilike(pattern), Product.sku.ilike(pattern)))
    if has_scripts:
        statement = statement.where(
            select(LiveRoomScriptLibrary.id)
            .where(LiveRoomScriptLibrary.product_id == Product.id)
            .exists()
        )
    return list(db.scalars(statement.order_by(Product.updated_at.desc()).offset(offset).limit(limit)))


@router.post(
    "/products",
    response_model=ProductResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_catalog_product(payload: ProductCreate, db: Session = Depends(get_db)):
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catalog_product(product_id: str, db: Session = Depends(get_db)):
    product = require_product(db, product_id)
    if product.source_type != "self_built":
        raise HTTPException(status_code=409, detail="only self-built products can be deleted")
    selected_count = db.scalar(
        select(func.count(LiveRoomProductSelection.id)).where(
            LiveRoomProductSelection.product_id == product_id
        )
    )
    if selected_count:
        raise HTTPException(
            status_code=409,
            detail="product is still selected in a live room; remove it from every room first",
        )
    db.delete(product)
    db.commit()


@router.get(
    "/live-rooms/{room_id}/products",
    response_model=list[LiveRoomProductResponse],
    response_model_exclude_none=True,
)
def list_room_products(room_id: str, db: Session = Depends(get_db)):
    require_room(db, room_id)
    return selected_products(db, room_id)


@router.post(
    "/live-rooms/{room_id}/products",
    response_model=LiveRoomProductResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_and_select_product(room_id: str, payload: LiveRoomProductCreate, db: Session = Depends(get_db)):
    require_room(db, room_id)
    product = Product(**payload.model_dump())
    db.add(product)
    db.flush()
    selection = LiveRoomProductSelection(
        live_room_id=room_id,
        product_id=product.id,
        sort_order=next_sort_order(db, room_id),
    )
    db.add(selection)
    db.commit()
    db.refresh(product)
    db.refresh(selection)
    return selection_response(product, selection)


@router.post(
    "/live-rooms/{room_id}/product-selections",
    response_model=list[LiveRoomProductResponse],
    response_model_exclude_none=True,
)
def attach_products(room_id: str, payload: LiveRoomProductSelectionCreate, db: Session = Depends(get_db)):
    require_room(db, room_id)
    product_ids = list(dict.fromkeys(payload.product_ids))
    products = list(db.scalars(select(Product).where(Product.id.in_(product_ids))))
    found_ids = {product.id for product in products}
    missing = [product_id for product_id in product_ids if product_id not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"products not found: {', '.join(missing)}")
    existing_ids = set(db.scalars(
        select(LiveRoomProductSelection.product_id).where(
            LiveRoomProductSelection.live_room_id == room_id,
            LiveRoomProductSelection.product_id.in_(product_ids),
        )
    ))
    order = next_sort_order(db, room_id)
    for product_id in product_ids:
        if product_id in existing_ids:
            continue
        db.add(LiveRoomProductSelection(live_room_id=room_id, product_id=product_id, sort_order=order))
        order += 1
    db.commit()
    return selected_products(db, room_id)


@router.put(
    "/live-rooms/{room_id}/products/{product_id}",
    response_model=LiveRoomProductResponse,
    response_model_exclude_none=True,
)
def update_product(room_id: str, product_id: str, payload: LiveRoomProductUpdate, db: Session = Depends(get_db)):
    require_room(db, room_id)
    product = require_product(db, product_id)
    selection = db.scalar(select(LiveRoomProductSelection).where(
        LiveRoomProductSelection.live_room_id == room_id,
        LiveRoomProductSelection.product_id == product_id,
    ))
    if selection is None:
        raise HTTPException(status_code=404, detail="product is not selected in this live room")
    if product.source_type == "platform":
        raise HTTPException(status_code=409, detail="platform products must be updated by synchronization")
    for key, value in payload.model_dump().items():
        setattr(product, key, value)
    product.updated_at = utc_now()
    db.commit()
    db.refresh(product)
    return selection_response(product, selection)


@router.delete("/live-rooms/{room_id}/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def detach_product(room_id: str, product_id: str, db: Session = Depends(get_db)):
    require_room(db, room_id)
    selection = db.scalar(select(LiveRoomProductSelection).where(
        LiveRoomProductSelection.live_room_id == room_id,
        LiveRoomProductSelection.product_id == product_id,
    ))
    if selection is None:
        raise HTTPException(status_code=404, detail="product selection not found")
    db.delete(selection)
    db.commit()


@router.put(
    "/live-rooms/{room_id}/product-selections/order",
    response_model=list[LiveRoomProductResponse],
    response_model_exclude_none=True,
)
def reorder_products(room_id: str, payload: LiveRoomProductSelectionOrder, db: Session = Depends(get_db)):
    require_room(db, room_id)
    selections = list(db.scalars(select(LiveRoomProductSelection).where(
        LiveRoomProductSelection.live_room_id == room_id
    )))
    by_id = {selection.id: selection for selection in selections}
    if len(payload.selection_ids) != len(by_id) or set(payload.selection_ids) != set(by_id):
        raise HTTPException(status_code=422, detail="selectionIds must contain every room selection exactly once")
    for order, selection_id in enumerate(payload.selection_ids):
        by_id[selection_id].sort_order = order
        by_id[selection_id].updated_at = utc_now()
    db.commit()
    return selected_products(db, room_id)


@router.get(
    "/live-rooms/{room_id}/scripts",
    response_model=list[LiveRoomScriptResponse],
    response_model_exclude_none=True,
)
def list_scripts(room_id: str, db: Session = Depends(get_db)):
    require_room(db, room_id)
    return list(db.scalars(select(LiveRoomScriptLibrary).where(
        LiveRoomScriptLibrary.live_room_id == room_id
    ).order_by(LiveRoomScriptLibrary.created_at.asc())))


@router.get(
    "/products/{product_id}/scripts",
    response_model=list[LiveRoomScriptResponse],
    response_model_exclude_none=True,
)
def list_product_scripts(product_id: str, db: Session = Depends(get_db)):
    require_product(db, product_id)
    return list(db.scalars(select(LiveRoomScriptLibrary).where(
        LiveRoomScriptLibrary.product_id == product_id
    ).order_by(LiveRoomScriptLibrary.created_at.desc())))


@router.post(
    "/live-rooms/{room_id}/scripts",
    response_model=LiveRoomScriptResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_script(room_id: str, payload: LiveRoomScriptCreate, db: Session = Depends(get_db)):
    require_room(db, room_id)
    if payload.product_id:
        selection = db.scalar(select(LiveRoomProductSelection).where(
            LiveRoomProductSelection.live_room_id == room_id,
            LiveRoomProductSelection.product_id == payload.product_id,
        ))
        if selection is None:
            raise HTTPException(status_code=422, detail="script product is not selected in the live room")
    script = LiveRoomScriptLibrary(live_room_id=room_id, **payload.model_dump())
    db.add(script)
    db.commit()
    db.refresh(script)
    return script


@router.put(
    "/live-rooms/{room_id}/scripts/{script_id}",
    response_model=LiveRoomScriptResponse,
    response_model_exclude_none=True,
)
def update_script(room_id: str, script_id: str, payload: LiveRoomScriptUpdate, db: Session = Depends(get_db)):
    require_room(db, room_id)
    script = db.scalar(select(LiveRoomScriptLibrary).where(
        LiveRoomScriptLibrary.id == script_id,
        LiveRoomScriptLibrary.live_room_id == room_id,
    ))
    if script is None:
        raise HTTPException(status_code=404, detail="script not found")
    if payload.product_id:
        require_product(db, payload.product_id)
    for key, value in payload.model_dump().items():
        setattr(script, key, value)
    script.updated_at = utc_now()
    db.commit()
    db.refresh(script)
    return script


@router.delete("/live-rooms/{room_id}/scripts/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_script(room_id: str, script_id: str, db: Session = Depends(get_db)):
    require_room(db, room_id)
    script = db.scalar(select(LiveRoomScriptLibrary).where(
        LiveRoomScriptLibrary.id == script_id,
        LiveRoomScriptLibrary.live_room_id == room_id,
    ))
    if script is None:
        raise HTTPException(status_code=404, detail="script not found")
    db.delete(script)
    db.commit()
