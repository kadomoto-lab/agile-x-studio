"""オーバーレイ GDS: 配線・配置ハイライト・部品ラベル。"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import gdsfactory as gf

from server.ga_obstacles import M5_LAYER, WIRE_WIDTH_UM
from server.ga_placement import PlacedGate, _cell_lookup
from server.ga_router import WireSegment

# ラベル用ハロー/テキスト層（PDK METAL4/METAL5 とは別の overlay 専用層）
LABEL_HALO_LAYER = (130, 0)
TEXT_LAYER = (131, 0)
TEXT_SIZE_UM = 16.0
TEXT_LINE_GAP_UM = 18.0
LABEL_HALO_PAD_UM = 5.0


def _cell_bbox(cell: dict) -> tuple[float, float, float, float]:
    ox = float(cell["origin"]["x"])
    oy = float(cell["origin"]["y"])
    w = float(cell["size"]["width"])
    h = float(cell["size"]["height"])
    return ox, oy, ox + w, oy + h


def _add_label(
    component: gf.Component,
    lines: list[str],
    cx: float,
    cy: float,
) -> None:
    """セル中心付近に白ハロー + 高コントラスト GDS TEXT。"""
    if not lines:
        return
    n = len(lines)
    y_start = cy + (n - 1) * TEXT_LINE_GAP_UM / 2
    pad = LABEL_HALO_PAD_UM
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        txt = component << gf.components.text(
            text=line,
            size=TEXT_SIZE_UM,
            layer=TEXT_LAYER,
        )
        bb = txt.dbbox()
        tw = bb.right - bb.left
        th = bb.top - bb.bottom
        y = y_start - i * TEXT_LINE_GAP_UM
        tx = cx - tw / 2
        ty = y - th / 2
        halo = component << gf.components.rectangle(
            size=(tw + pad * 2, th + pad * 2),
            layer=LABEL_HALO_LAYER,
        )
        halo.move((tx - pad, ty - pad))
        txt.move((tx, ty))


def _label_lines(pg: PlacedGate, gates_per_component: dict[str, int]) -> list[str]:
    """回路図の参照名 + 素子種別のみ（内部 SPICE 实例名 X_BC 等は出さない）。"""
    ref = f"X{pg.slot.component_ref}"
    subckt = pg.slot.subckt
    gate_count = gates_per_component.get(pg.slot.component_ref, 1)
    if gate_count > 1:
        # NAND2 等: 同一素子内の GA サイト番号
        return [ref, f"{subckt} GA{pg.slot.gate_index + 1}/{gate_count}"]
    return [ref, subckt]


def add_placement_marks(
    component: gf.Component,
    placed: list[PlacedGate],
    catalog: dict,
) -> None:
    cells = _cell_lookup(catalog)
    gates_per_component: dict[str, int] = {}
    for pg in placed:
        key = pg.slot.component_ref
        gates_per_component[key] = gates_per_component.get(key, 0) + 1

    for pg in placed:
        cell = cells.get((pg.row, pg.col))
        if cell is None:
            continue
        x0, y0, x1, y1 = _cell_bbox(cell)
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        _add_label(component, _label_lines(pg, gates_per_component), cx, cy)


def _point_key(x: float, y: float) -> tuple[float, float]:
    return (round(x, 3), round(y, 3))


def _segments_to_polylines(segments: list[WireSegment]) -> list[list[tuple[float, float]]]:
    """path_id ごとにセグメント列を polyline に連結する。"""
    groups: dict[tuple[str, int], list[WireSegment]] = defaultdict(list)
    for seg in segments:
        groups[(seg.net_key, seg.path_id)].append(seg)

    polylines: list[list[tuple[float, float]]] = []
    for segs in groups.values():
        if not segs:
            continue
        adj: dict[tuple[float, float], list[tuple[float, float]]] = defaultdict(list)
        edges: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for seg in segs:
            p0 = _point_key(seg.x0, seg.y0)
            p1 = _point_key(seg.x1, seg.y1)
            if p0 == p1:
                continue
            adj[p0].append(p1)
            adj[p1].append(p0)
            edges.append((p0, p1))

        seen_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
        endpoints = [pt for pt, nbs in adj.items() if len(nbs) == 1]
        starts = endpoints if endpoints else [edges[0][0]]

        for start in starts:
            if start not in adj:
                continue
            chain = [start]
            current = start
            while True:
                next_pt = None
                for nb in adj[current]:
                    edge = (current, nb) if current < nb else (nb, current)
                    if edge in seen_edges:
                        continue
                    next_pt = nb
                    seen_edges.add(edge)
                    break
                if next_pt is None:
                    break
                chain.append(next_pt)
                current = next_pt
            if len(chain) >= 2:
                polylines.append(chain)

        for p0, p1 in edges:
            edge = (p0, p1) if p0 < p1 else (p1, p0)
            if edge not in seen_edges:
                polylines.append([p0, p1])

    return polylines


def _compress_collinear(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    out = [points[0]]
    for i in range(1, len(points) - 1):
        ax, ay = out[-1]
        bx, by = points[i]
        cx, cy = points[i + 1]
        if abs(ax - bx) < 1e-6 and abs(bx - cx) < 1e-6:
            continue
        if abs(ay - by) < 1e-6 and abs(by - cy) < 1e-6:
            continue
        out.append((bx, by))
    out.append(points[-1])
    return out


def _remove_axis_backtracks(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """同一軸上の折返し（上下往復）を除去して直角コーナーを保つ。"""
    if len(points) < 3:
        return points
    out = [points[0]]
    for i in range(1, len(points) - 1):
        prev = out[-1]
        cur = points[i]
        nxt = points[i + 1]
        if abs(prev[0] - cur[0]) < 1e-6 and abs(cur[0] - nxt[0]) < 1e-6:
            if (cur[1] - prev[1]) * (nxt[1] - cur[1]) < 0:
                continue
        if abs(prev[1] - cur[1]) < 1e-6 and abs(cur[1] - nxt[1]) < 1e-6:
            if (cur[0] - prev[0]) * (nxt[0] - cur[0]) < 0:
                continue
        out.append(cur)
    out.append(points[-1])
    return out


def _manhattan_wire_rects(
    points: list[tuple[float, float]],
    width: float,
) -> list[tuple[float, float, float, float]]:
    """Manhattan polyline を幅 width の矩形群に分解（角は w×w、腕は width/2 トリム）。"""
    if len(points) < 2:
        return []
    hw = width / 2.0
    rects: list[tuple[float, float, float, float]] = []

    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        if abs(x0 - x1) < 1e-6 and abs(y0 - y1) < 1e-6:
            continue
        if abs(x0 - x1) < 1e-6:
            y_lo, y_hi = sorted((y0, y1))
            if i > 0:
                y_lo += hw
            if i < len(points) - 2:
                y_hi -= hw
            if y_hi - y_lo > 1e-6:
                rects.append((x0 - hw, y_lo, width, y_hi - y_lo))
        elif abs(y0 - y1) < 1e-6:
            x_lo, x_hi = sorted((x0, x1))
            if i > 0:
                x_lo += hw
            if i < len(points) - 2:
                x_hi -= hw
            if x_hi - x_lo > 1e-6:
                rects.append((x_lo, y0 - hw, x_hi - x_lo, width))

    for i in range(1, len(points) - 1):
        px, py = points[i]
        rects.append((px - hw, py - hw, width, width))

    return rects


def _add_wire_rect(
    component: gf.Component,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    layer: tuple[int, int] = M5_LAYER,
) -> None:
    if w < 1e-6 or h < 1e-6:
        return
    rect = component << gf.components.rectangle(size=(w, h), layer=layer)
    rect.move((x, y))


def wire_rects_by_net(
    segments: list[WireSegment],
    *,
    width: float = WIRE_WIDTH_UM,
) -> list[tuple[str, tuple[float, float, float, float]]]:
    """GDS に書き出す METAL5 矩形 (net_key, (x0, y0, x1, y1)) の一覧。

    _add_wire_polylines と同一の分解を行う（検証で実際の出力形状を使うため）。
    """
    by_net: dict[str, list[WireSegment]] = defaultdict(list)
    for seg in segments:
        by_net[seg.net_key].append(seg)
    out: list[tuple[str, tuple[float, float, float, float]]] = []
    for net_key, segs in by_net.items():
        for poly in _segments_to_polylines(segs):
            cleaned = _remove_axis_backtracks(_compress_collinear(poly))
            for rx, ry, rw, rh in _manhattan_wire_rects(cleaned, width):
                if rw < 1e-6 or rh < 1e-6:
                    continue
                out.append((net_key, (rx, ry, rx + rw, ry + rh)))
    return out


def _add_wire_polylines(
    component: gf.Component,
    segments: list[WireSegment],
    *,
    layer: tuple[int, int] = M5_LAYER,
    width: float = WIRE_WIDTH_UM,
) -> None:
    """METAL5 配線を Manhattan 角処理付き矩形群で描画。"""
    for poly in _segments_to_polylines(segments):
        cleaned = _remove_axis_backtracks(_compress_collinear(poly))
        for rx, ry, rw, rh in _manhattan_wire_rects(cleaned, width):
            _add_wire_rect(component, rx, ry, rw, rh, layer=layer)


def generate_overlay_gds(
    segments: list[WireSegment],
    output: Path,
    *,
    placed: list[PlacedGate] | None = None,
    catalog: dict | None = None,
) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    c = gf.Component("schematic_overlay")

    if placed and catalog:
        add_placement_marks(c, placed, catalog)

    _add_wire_polylines(c, segments, layer=M5_LAYER, width=WIRE_WIDTH_UM)

    # with_metadata=False: KLayout 専用の $$$CONTEXT_INFO$$$ セルを書かない
    # （他の GDS リーダーが Invalid record エラーを出すため）
    c.write_gds(output, with_metadata=False)
    return output
