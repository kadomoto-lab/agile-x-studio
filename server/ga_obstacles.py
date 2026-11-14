"""base.gds の METAL5 を障害物グリッドにラスタライズする。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import gdsfactory as gf

WIRE_WIDTH_UM = 5.0
WIRE_CLEARANCE_UM = 5.0
GRID_PITCH_UM = 5.0
# 異ネット間: 配線幅 5 µm + 両側クリアランス 5 µm → 中心線は 3 グリッド（15 µm）以上離す
WIRE_SPREAD_CELLS = 1
M5_LAYER = (33, 0)
TERMINAL_CLEAR_UM = 7.5
# gdsfactory / KLayout polygon coordinates are nm; gate-array catalog uses µm
NM_TO_UM = 1e-3


def snap_grid_um(value: float, origin: float = 0.0, pitch: float = GRID_PITCH_UM) -> float:
    """値を配線グリッド（pitch の倍数 + origin）にスナップ。"""
    return round((value - origin) / pitch) * pitch + origin


def snap_point_um(
    x: float,
    y: float,
    origin_x: float = 0.0,
    origin_y: float = 0.0,
    pitch: float = GRID_PITCH_UM,
) -> tuple[float, float]:
    return snap_grid_um(x, origin_x, pitch), snap_grid_um(y, origin_y, pitch)


def _poly_bbox_um(poly) -> tuple[float, float, float, float]:
    bb = poly.bbox()
    return (
        bb.left * NM_TO_UM,
        bb.bottom * NM_TO_UM,
        bb.right * NM_TO_UM,
        bb.top * NM_TO_UM,
    )


@lru_cache(maxsize=4)
def _load_m5_boxes(gds_path: str, mtime_ns: int) -> tuple[tuple[float, float, float, float], ...]:
    _ = mtime_ns
    comp = gf.import_gds(gds_path)
    polys = comp.get_polygons(by="tuple").get(M5_LAYER, [])
    return tuple(_poly_bbox_um(poly) for poly in polys)


def load_m5_obstacle_boxes(gds_path: Path) -> list[tuple[float, float, float, float]]:
    stat = gds_path.stat()
    return list(_load_m5_boxes(str(gds_path), stat.st_mtime_ns))


# base.gds 内の低層メタルジャンパセル（両端に METAL5 パッドを持つ M4 ライン）
JUMPER_CELL_PREFIX = "ga_top_JUMPLINE"


@lru_cache(maxsize=4)
def _load_jumper_pairs(
    gds_path: str, mtime_ns: int
) -> tuple[tuple[tuple[float, float], tuple[float, float]], ...]:
    _ = mtime_ns
    import klayout.db as kdb

    layout = kdb.Layout()
    layout.read(gds_path)
    m5 = layout.find_layer(M5_LAYER[0], M5_LAYER[1])
    if m5 is None:
        return ()
    pairs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for top in layout.top_cells():
        it = top.begin_instances_rec()
        while not it.at_end():
            inst_cell = layout.cell(it.inst_cell().cell_index())
            if not inst_cell.name.startswith(JUMPER_CELL_PREFIX):
                it.next()
                continue
            trans = it.trans() * it.inst_trans()
            centers: list[tuple[float, float]] = []
            shapes = inst_cell.begin_shapes_rec(m5)
            while not shapes.at_end():
                box = shapes.shape().bbox().transformed(shapes.trans())
                box = box.transformed(trans)
                c = box.center()
                centers.append(
                    (round(c.x * layout.dbu, 3), round(c.y * layout.dbu, 3))
                )
                shapes.next()
            if len(centers) == 2:
                pairs.append((centers[0], centers[1]))
            it.next()
    return tuple(pairs)


def load_jumper_pairs(
    gds_path: Path,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """base.gds の JUMPLINE セル（M4 ジャンパ）の両端 METAL5 パッド中心 [µm] の組。

    - JUMPLINE2: 各 GA サイトの Y=5 ↔ Y=145（行を跨ぐ）
    - JUMPLINE1: 行間ギャップ内の 40 µm 縦ジャンパ（水平配線を跨ぐ）
    """
    stat = gds_path.stat()
    return list(_load_jumper_pairs(str(gds_path), stat.st_mtime_ns))


def expand_bbox(
    box: tuple[float, float, float, float],
    margin: float,
) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = box
    return (x0 - margin, y0 - margin, x1 + margin, y1 + margin)


def wire_center_bbox(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    *,
    width_um: float = WIRE_WIDTH_UM,
    margin_um: float = 0.0,
) -> tuple[float, float, float, float]:
    hw = width_um / 2.0 + margin_um
    return (
        min(x0, x1) - hw,
        min(y0, y1) - hw,
        max(x0, x1) + hw,
        max(y0, y1) + hw,
    )


def boxes_overlap(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> bool:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    return not (ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0)


def segment_blocked(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    boxes: list[tuple[float, float, float, float]],
    *,
    width_um: float = WIRE_WIDTH_UM,
    clearance_um: float = WIRE_CLEARANCE_UM,
) -> bool:
    wire = wire_center_bbox(
        x0, y0, x1, y1, width_um=width_um, margin_um=clearance_um
    )
    return any(boxes_overlap(wire, box) for box in boxes)


def routing_obstacle_boxes(
    base_boxes: list[tuple[float, float, float, float]],
    wire_segments: list,
    exclude_net: str,
    *,
    clearance_um: float = WIRE_CLEARANCE_UM,
) -> list[tuple[float, float, float, float]]:
    """配線済み METAL5 + base.gds 障害物（他ネットはクリアランス付き bbox）。"""
    boxes = [
        expand_bbox(box, clearance_um + WIRE_WIDTH_UM / 2.0)
        for box in base_boxes
    ]
    for seg in wire_segments:
        if seg.net_key == exclude_net:
            continue
        boxes.append(
            wire_center_bbox(
                seg.x0,
                seg.y0,
                seg.x1,
                seg.y1,
                width_um=seg.width_um,
                margin_um=clearance_um,
            )
        )
    return boxes


def manhattan_route_avoiding(
    start: tuple[float, float],
    end: tuple[float, float],
    boxes: list[tuple[float, float, float, float]],
    *,
    pitch_um: float = GRID_PITCH_UM,
    width_um: float = WIRE_WIDTH_UM,
    clearance_um: float = WIRE_CLEARANCE_UM,
    allow_terminal: tuple[bool, bool] = (False, False),
) -> list[tuple[float, float]] | None:
    """5 µm グリッド上の Manhattan 経路（既存 METAL5 / 配線 bbox を回避）。"""
    import heapq

    sx, sy = snap_point_um(start[0], start[1], pitch=pitch_um)
    ex, ey = snap_point_um(end[0], end[1], pitch=pitch_um)
    if abs(sx - ex) < 1e-6 and abs(sy - ey) < 1e-6:
        return [(sx, sy)]

    x_lo = min(sx, ex) - 80.0
    x_hi = max(sx, ex) + 80.0
    y_lo = min(sy, ey) - 80.0
    y_hi = max(sy, ey) + 80.0

    def node_blocked(x: float, y: float, *, is_start: bool, is_end: bool) -> bool:
        if is_start and allow_terminal[0]:
            return False
        if is_end and allow_terminal[1]:
            return False
        return segment_blocked(x, y, x, y, boxes, width_um=width_um, clearance_um=clearance_um)

    if node_blocked(sx, sy, is_start=True, is_end=False) or node_blocked(
        ex, ey, is_start=False, is_end=True
    ):
        return None

    start_n = (sx, sy)
    end_n = (ex, ey)
    open_heap: list[tuple[float, int, tuple[float, float]]] = []
    counter = 0
    g_score: dict[tuple[float, float], float] = {start_n: 0.0}
    came: dict[tuple[float, float], tuple[float, float] | None] = {start_n: None}
    heapq.heappush(open_heap, (abs(ex - sx) + abs(ey - sy), counter, start_n))
    counter += 1

    while open_heap:
        _, _, node = heapq.heappop(open_heap)
        if node == end_n:
            path: list[tuple[float, float]] = []
            cur: tuple[float, float] | None = node
            while cur is not None:
                path.append(cur)
                cur = came[cur]
            path.reverse()
            # 隣接点間のセグメントが障害物と交差しないか確認
            for i in range(len(path) - 1):
                x0, y0 = path[i]
                x1, y1 = path[i + 1]
                if segment_blocked(
                    x0, y0, x1, y1, boxes, width_um=width_um, clearance_um=clearance_um
                ):
                    return None
            return path

        nx, ny = node
        base_g = g_score[node]
        for dx, dy in ((pitch_um, 0.0), (-pitch_um, 0.0), (0.0, pitch_um), (0.0, -pitch_um)):
            nb = (round(nx + dx, 3), round(ny + dy, 3))
            if not (x_lo <= nb[0] <= x_hi and y_lo <= nb[1] <= y_hi):
                continue
            if node_blocked(nb[0], nb[1], is_start=False, is_end=nb == end_n):
                continue
            if segment_blocked(
                nx, ny, nb[0], nb[1], boxes, width_um=width_um, clearance_um=clearance_um
            ):
                continue
            ng = base_g + pitch_um
            if ng < g_score.get(nb, float("inf")):
                g_score[nb] = ng
                came[nb] = node
                h = abs(ex - nb[0]) + abs(ey - nb[1])
                heapq.heappush(open_heap, (ng + h, counter, nb))
                counter += 1
    return None
