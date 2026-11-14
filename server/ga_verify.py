"""生成した METAL5 配線の独立検証（簡易 LVS / DRC）。

ルーター内部の塗りつぶし状態ではなく、実際に GDS へ書き出すセグメントと
base.gds の METAL5 形状だけから導通を再構成し、次を検査する:

- 短絡: 異なるネットの導体が 1 つの連結成分に混在していないか
- 開放: 各信号ネットの全ピン（+ I/O パッド）が 1 つの連結成分にあるか、
  電源ピンが電源バスに接続されているか
- 間隔: 配線と別導体の辺間距離が WIRE_CLEARANCE_UM 未満になっていないか

導通モデル:
- 矩形同士が重なる／接する → 導通
- 同一ピン列の 6 段パッド (Y=5..145) は下層で導通（1 ノード）
- JUMPLINE（M4 ジャンパ）の両端パッドは導通（1 ノード）
- 各行の VDD/VSS バスはチップ全体で電源網に接続（クラス単位で 1 ノード）
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from server.ga_extract import LayoutProblem
from server.ga_obstacles import WIRE_CLEARANCE_UM
from server.ga_placement import PlacedGate, _cell_lookup
from server.ga_router import WireSegment
from server.ga_terminals import (
    SIGNAL_PIN_X,
    TERMINAL_Y,
    global_routing_from_catalog,
    io_pads_from_catalog,
    net_kind,
)

Box = tuple[float, float, float, float]

_BUCKET_UM = 20.0
_EPS = 1e-6


def _net_class(net_key: str) -> str:
    kind = net_kind(net_key)
    if kind == "vdd":
        return "supply:vdd"
    if kind == "vss":
        return "supply:vss"
    return net_key


def _key(x: float, y: float) -> tuple[float, float]:
    return (round(x, 2), round(y, 2))


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, a: str) -> None:
        self.parent.setdefault(a, a)

    def find(self, a: str) -> str:
        parent = self.parent
        parent.setdefault(a, a)
        root = a
        while parent[root] != root:
            root = parent[root]
        while parent[a] != root:
            parent[a], a = root, parent[a]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


@dataclass
class VerifyReport:
    shorts: list[str]
    opens: list[str]
    spacing: list[str]

    @property
    def ok(self) -> bool:
        return not (self.shorts or self.opens or self.spacing)

    def errors(self) -> list[str]:
        return (
            [f"short: {m}" for m in self.shorts]
            + [f"open: {m}" for m in self.opens]
            + [f"spacing: {m}" for m in self.spacing]
        )


def _seg_box(seg: WireSegment) -> Box:
    hw = seg.width_um / 2.0
    return (
        min(seg.x0, seg.x1) - hw,
        min(seg.y0, seg.y1) - hw,
        max(seg.x0, seg.x1) + hw,
        max(seg.y0, seg.y1) + hw,
    )


def _gap(a: Box, b: Box) -> float:
    """辺間距離。接触・重なりは 0 以下。"""
    dx = max(b[0] - a[2], a[0] - b[2])
    dy = max(b[1] - a[3], a[1] - b[3])
    if dx <= _EPS and dy <= _EPS:
        return min(dx, dy)
    return math.hypot(max(dx, 0.0), max(dy, 0.0))


def _buckets(box: Box, margin: float = 0.0):
    x0 = int(math.floor((box[0] - margin) / _BUCKET_UM))
    x1 = int(math.floor((box[2] + margin) / _BUCKET_UM))
    y0 = int(math.floor((box[1] - margin) / _BUCKET_UM))
    y1 = int(math.floor((box[3] + margin) / _BUCKET_UM))
    for bx in range(x0, x1 + 1):
        for by in range(y0, y1 + 1):
            yield (bx, by)


def verify_routing(
    segments: list[WireSegment],
    problem: LayoutProblem,
    placed: list[PlacedGate],
    catalog: dict,
    base_boxes: list[Box],
    jumper_pairs: list[tuple[tuple[float, float], tuple[float, float]]],
    *,
    io_bindings: list | None = None,
    min_spacing: float = WIRE_CLEARANCE_UM,
    max_messages: int = 8,
) -> VerifyReport:
    io_bindings = io_bindings or []
    cells = _cell_lookup(catalog)
    gr = global_routing_from_catalog(catalog)
    vss_bus = float(gr["vssBusY"])
    vdd_bus = float(gr["vddBusY"])

    # --- base.gds 形状のノード割当 ---
    pin_stack_at: dict[tuple[float, float], str] = {}
    supply_ys: dict[float, str] = {}
    for (row, col), cell in cells.items():
        ox = float(cell["origin"]["x"])
        oy = float(cell["origin"]["y"])
        for pin, px in SIGNAL_PIN_X.items():
            for ty in TERMINAL_Y:
                pin_stack_at[_key(ox + px, oy + ty)] = f"pin:{row}:{col}:{pin}"
        supply_ys[round(oy + vss_bus, 2)] = "supply:vss"
        supply_ys[round(oy + vdd_bus, 2)] = "supply:vdd"

    jumper_at: dict[tuple[float, float], str] = {}
    for idx, (p0, p1) in enumerate(jumper_pairs):
        jumper_at[_key(*p0)] = f"jmp:{idx}"
        jumper_at[_key(*p1)] = f"jmp:{idx}"

    in_pads, out_pads = io_pads_from_catalog(catalog)
    io_pad_nodes: list[tuple[float, float, str]] = []
    for direction, table in (("IN", in_pads), ("OUT", out_pads)):
        for idx, (px, py) in table.items():
            io_pad_nodes.append((px, py, f"io:{direction}:{idx}"))

    def base_node(i: int, box: Box) -> str:
        cx = (box[0] + box[2]) / 2.0
        cy = (box[1] + box[3]) / 2.0
        k = _key(cx, cy)
        if k in pin_stack_at:
            return pin_stack_at[k]
        if k in jumper_at:
            return jumper_at[k]
        # VDD/VSS バス行の METAL5（バス本体と、バスに重なる小片）
        if abs(box[3] - box[1] - 5.0) < 0.01 and not (
            abs(box[2] - box[0] - 5.0) < 0.01
        ):
            sup = supply_ys.get(round(cy, 2))
            if sup is not None:
                return sup
        for px, py, name in io_pad_nodes:
            if abs(cx - px) < 3.0 and abs(cy - py) < 1.0:
                return name
        return f"base:{i}"

    uf = _UnionFind()
    labels: dict[str, set[str]] = defaultdict(set)

    # 形状リスト: (box, node, is_wire)
    shapes: list[tuple[Box, str, bool]] = []
    for i, box in enumerate(base_boxes):
        shapes.append((box, base_node(i, box), False))
    # 検証対象は GDS に実際に書き出す矩形（ポリライン化・角処理後）
    from server.ga_overlay import wire_rects_by_net

    for i, (net_key, box) in enumerate(wire_rects_by_net(segments)):
        node = f"wire:{i}"
        shapes.append((box, node, True))
        labels[node].add(_net_class(net_key))
    labels["supply:vdd"].add("supply:vdd")
    labels["supply:vss"].add("supply:vss")

    # ピン列ノードの期待ネット
    pg_map = {(pg.slot.component_ref, pg.slot.gate_instance): pg for pg in placed}
    expected_nodes: dict[str, set[str]] = defaultdict(set)
    for net_key, eps in problem.net_groups.items():
        for ep in eps:
            pg = pg_map.get((ep.component_ref, ep.gate_instance))
            if pg is None:
                continue
            node = f"pin:{pg.row}:{pg.col}:{ep.gate_pin}"
            labels[node].add(_net_class(net_key))
            expected_nodes[net_key].add(node)
    for b in io_bindings:
        node = f"io:{b.direction}:{b.index}"
        labels[node].add(_net_class(b.net_key))
        if net_kind(b.net_key) == "signal" and b.net_key in problem.net_groups:
            expected_nodes[b.net_key].add(node)

    for _, node, _ in shapes:
        uf.add(node)

    # --- 空間インデックスで配線形状の接触・間隔を判定 ---
    index: dict[tuple[int, int], list[int]] = defaultdict(list)
    for si, (box, _, _) in enumerate(shapes):
        for b in _buckets(box):
            index[b].append(si)

    near_pairs: list[tuple[int, int, float]] = []
    for si, (box, node, is_wire) in enumerate(shapes):
        if not is_wire:
            continue
        seen: set[int] = set()
        for b in _buckets(box, min_spacing):
            for sj in index.get(b, ()):
                if sj == si or sj in seen:
                    continue
                seen.add(sj)
                other_box, other_node, other_wire = shapes[sj]
                if other_wire and sj < si:
                    continue
                g = _gap(box, other_box)
                if g <= _EPS:
                    uf.union(node, other_node)
                elif g < min_spacing - _EPS:
                    near_pairs.append((si, sj, g))

    # --- 連結成分ごとのラベル集合 ---
    comp_labels: dict[str, set[str]] = defaultdict(set)
    for node, labs in labels.items():
        comp_labels[uf.find(node)] |= labs

    shorts: list[str] = []
    for root, labs in comp_labels.items():
        if len(labs) > 1:
            shorts.append(", ".join(sorted(labs)))

    opens: list[str] = []
    for net_key, nodes in sorted(expected_nodes.items()):
        kind = net_kind(net_key)
        if kind == "signal":
            roots = {uf.find(n) for n in nodes}
            if len(roots) > 1:
                opens.append(f"{net_key} split into {len(roots)} parts")
        else:
            supply_root = uf.find(_net_class(net_key))
            missing = [n for n in nodes if uf.find(n) != supply_root]
            if missing:
                opens.append(f"{net_key} pins not on supply: {sorted(missing)[:4]}")

    spacing: list[str] = []
    for si, sj, g in near_pairs:
        if uf.find(shapes[si][1]) == uf.find(shapes[sj][1]):
            continue
        a, b = shapes[si][0], shapes[sj][0]
        spacing.append(
            f"{g:.2f} µm between {shapes[si][1]}{tuple(round(v, 1) for v in a)} "
            f"and {shapes[sj][1]}{tuple(round(v, 1) for v in b)}"
        )

    return VerifyReport(
        shorts=shorts[:max_messages],
        opens=opens[:max_messages],
        spacing=spacing[:max_messages],
    )
