"""ゲートアレイ FAB メタデータの読み込み。"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE_ARRAY_JSON = ROOT / "public" / "fab" / "gate-array.json"
PRIMITIVES_JSON = ROOT / "public" / "fab" / "primitives.json"

_catalog_cache: tuple[int, dict] | None = None
_primitives_cache: tuple[int, dict] | None = None


def load_gate_array_catalog() -> dict:
    global _catalog_cache
    if not GATE_ARRAY_JSON.is_file():
        raise FileNotFoundError(
            f"Gate array catalog not found: {GATE_ARRAY_JSON}. "
            "Run: python3 scripts/export_gate_array.py"
        )
    mtime_ns = GATE_ARRAY_JSON.stat().st_mtime_ns
    if _catalog_cache is not None and _catalog_cache[0] == mtime_ns:
        return _catalog_cache[1]
    catalog = json.loads(GATE_ARRAY_JSON.read_text(encoding="utf-8"))
    _catalog_cache = (mtime_ns, catalog)
    return catalog


def load_primitive_catalog() -> dict:
    global _primitives_cache
    if not PRIMITIVES_JSON.is_file():
        raise FileNotFoundError(f"Primitive catalog not found: {PRIMITIVES_JSON}")
    mtime_ns = PRIMITIVES_JSON.stat().st_mtime_ns
    if _primitives_cache is not None and _primitives_cache[0] == mtime_ns:
        return _primitives_cache[1]
    catalog = json.loads(PRIMITIVES_JSON.read_text(encoding="utf-8"))
    _primitives_cache = (mtime_ns, catalog)
    return catalog


def get_primitive_by_subckt(spice_subckt: str) -> dict | None:
    catalog = load_primitive_catalog()
    for primitive in catalog.get("primitives", []):
        if primitive.get("spiceSubckt") == spice_subckt:
            return primitive
    return None


def get_base_gds_path() -> Path:
    catalog = load_gate_array_catalog()
    rel = catalog["baseGds"]["path"]
    path = ROOT / rel
    if not path.is_file():
        raise FileNotFoundError(f"base GDS not found: {path}")
    return path


def get_base_forfab_gds_path() -> Path:
    """製造データ用の base GDS。base.gds と同じ座標系を前提とする。"""
    path = ROOT / "public" / "base_forfab.gds"
    if not path.is_file():
        raise FileNotFoundError(f"base for-fab GDS not found: {path}")
    return path
