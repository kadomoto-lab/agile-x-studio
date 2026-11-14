"""METAL5 配線セグメントの型定義と幾何検証ヘルパー。

経路探索本体は ga_grid_router.PaintGrid（10 µm セル塗りつぶし式）が担う。
本モジュールは WireSegment 型と、テスト・検証用の幾何ユーティリティのみを持つ。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations

from server.ga_obstacles import WIRE_CLEARANCE_UM, WIRE_WIDTH_UM


@dataclass(frozen=True)
class WireSegment:
    x0: float
    y0: float
    x1: float
    y1: float
    width_um: float = WIRE_WIDTH_UM
    net_key: str = ""
    path_id: int = 0


def orthogonal_wire_segments(
    points: list[tuple[float, float]],
    net_key: str,
    path_id: int,
    *,
    width_um: float = WIRE_WIDTH_UM,
) -> list[WireSegment]:
    """Manhattan 折れ線を同一 path_id の直交セグメント列に変換する。

    同一 path_id にまとめることで ga_overlay._manhattan_wire_rects が
    5 µm 幅の直角コーナー（w×w パッチ）を描画できる。
    """
    if len(points) < 2:
        return []
    compressed: list[tuple[float, float]] = [points[0]]
    for i in range(1, len(points) - 1):
        ax, ay = compressed[-1]
        bx, by = points[i]
        cx, cy = points[i + 1]
        if (abs(ax - bx) < 1e-6 and abs(bx - cx) < 1e-6) or (
            abs(ay - by) < 1e-6 and abs(by - cy) < 1e-6
        ):
            continue
        compressed.append((bx, by))
    compressed.append(points[-1])
    segments: list[WireSegment] = []
    for i in range(len(compressed) - 1):
        x0, y0 = compressed[i]
        x1, y1 = compressed[i + 1]
        if abs(x0 - x1) < 1e-6 and abs(y0 - y1) < 1e-6:
            continue
        segments.append(
            WireSegment(x0, y0, x1, y1, width_um, net_key, path_id)
        )
    return segments


def _is_horizontal(seg: WireSegment) -> bool:
    return abs(seg.y0 - seg.y1) < 1e-6


def _parallel_horizontal_edge_gap(a: WireSegment, b: WireSegment) -> float | None:
    """水平同士で X 投影が重なるときの辺間距離 [µm]。該当しなければ None。"""
    if not _is_horizontal(a) or not _is_horizontal(b):
        return None
    hw = a.width_um / 2.0
    x_lo = max(min(a.x0, a.x1), min(b.x0, b.x1))
    x_hi = min(max(a.x0, a.x1), max(b.x0, b.x1))
    if x_hi - x_lo <= 1e-6:
        return None
    ya, yb = a.y0, b.y0
    if ya <= yb:
        return (yb - hw) - (ya + hw)
    return (ya - hw) - (yb + hw)


def _segment_bbox(seg: WireSegment) -> tuple[float, float, float, float]:
    hw = seg.width_um / 2.0
    x_lo, x_hi = sorted((seg.x0, seg.x1))
    y_lo, y_hi = sorted((seg.y0, seg.y1))
    return (x_lo - hw, y_lo - hw, x_hi + hw, y_hi + hw)


def _bbox_edge_gap(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    """2 矩形の辺間最短距離 [µm]。重なり時は負。"""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    dx = max(bx0 - ax1, ax0 - bx1, 0.0)
    dy = max(by0 - ay1, ay0 - by1, 0.0)
    if dx == 0.0 and dy == 0.0:
        return -min(ax1 - bx0, bx1 - ax0, ay1 - by0, by1 - ay0)
    return math.hypot(dx, dy)


def validate_cross_net_clearance(
    segments: list[WireSegment],
    *,
    min_gap: float = WIRE_CLEARANCE_UM,
) -> bool:
    """異ネット配線 bbox 間のクリアランス（辺間 min_gap 以上）を検証。"""
    indexed = list(enumerate(segments))
    for (i, a), (j, b) in combinations(indexed, 2):
        if a.net_key == b.net_key:
            continue
        gap = _bbox_edge_gap(_segment_bbox(a), _segment_bbox(b))
        if gap < min_gap - 1e-6:
            return False
    return True
