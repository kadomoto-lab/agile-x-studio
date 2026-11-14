#!/usr/bin/env python3
"""GA 配置・配線パイプラインの簡易テスト。

配線アルゴリズム（ga_router / ga_sync / ga_placement 等）を改変した際は
必ず本テストを実行し、少なくとも次の代表回路が同期できることを確認すること:
  - INV Chain (2×INV) … デフォルト回路・ゲート間配線
  - INV + NAND2 … U1 OUT を NAND の A/B 両入力に接続する混合回路
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.ga_netlist import parse_ga_instances
from server.ga_extract import build_layout_problem
from server.ga_sync import sync_ga_layout

import gdsfactory as gf

# gdsfactory 9.29.0 以降は汎用 PDK が自動で有効化されないため明示的に有効化する
gf.gpdk.PDK.activate()

# src/schematic/spice/gabasecell.ts の SPICE_PREAMBLE と同等（モデル定義省略可）
SPICE_PREAMBLE = """* GA base cell library
.SUBCKT Z__GABASECELL G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS
.ENDS
.SUBCKT INV IN OUT VDD VSS
X_BC IN IN OUT VSS OUT OUT VDD OUT VDD VSS Z__GABASECELL
.ENDS
.SUBCKT NOR2 A B OUT VDD VSS
X_BC A B OUT VSS OUT OUT _NOR2_PMID VDD VDD VSS Z__GABASECELL
.ENDS
.SUBCKT NAND2 A B OUT VDD VSS
X_BC A B OUT _NAND2_NMID VSS OUT VDD OUT VDD VSS Z__GABASECELL
.ENDS
"""

INV_CHAIN = SPICE_PREAMBLE + """
* INV Chain (2x) — default schematic
XU1 n1 n2 VDD 0 INV
XU2 n2 out VDD 0 INV
"""

INV_NAND2 = SPICE_PREAMBLE + """
* INV driving NAND2 inputs (A=B=n2)
XU1 n1 n2 VDD 0 INV
XU2 n2 n2 out VDD 0 NAND2
"""

INV_CHAIN_3X = SPICE_PREAMBLE + """
* 3×INV: U1 → U3 → U2 (netlist order differs from signal flow)
XU1 n1 n2 VDD 0 INV
XU2 n3 out VDD 0 INV
XU3 n2 n3 VDD 0 INV
"""

INV_CHAIN_3X_PULSE = SPICE_PREAMBLE + """
* 3×INV with stimulus (n2 / n3 must not merge in layout)
V2 n1 0 PULSE(0 1.8 0 1n 1n 0.5u 1u)
XU1 n1 n2 VDD 0 INV
XU2 n3 out VDD 0 INV
XU3 n2 n3 VDD 0 INV
"""

INV_IO_OUT = SPICE_PREAMBLE + """
* INV output to ga_out[0]
* GA_IO OUT 0 out
XU1 n1 out VDD 0 INV
"""

INV_CHAIN_IO11 = SPICE_PREAMBLE + """
* 2x INV chain to ga_out[11]
V2 n1 0 PULSE(0 1.8 0 1n 1n 0.5u 1u)
XU1 n1 n2 VDD 0 INV
XU2 n2 n3 VDD 0 INV
* GA_IO OUT 11 n3
"""

INV_CHAIN_NAND_RING_IO = SPICE_PREAMBLE + """
* 2x INV + NAND2 ring, ga_out[0] on n3 (same-row global I/O stress)
XU1 n1 n2 VDD 0 INV
XU2 n2 n3 VDD 0 INV
XU3 VDD n3 n1 VDD 0 NAND2
* GA_IO OUT 0 n3
"""

DEFAULT_LOOP_IO = SPICE_PREAMBLE + """
* Default: 2×INV + NAND2 + 6×INV ring → ga_out[0] on n4
XU1 n1 n2 VDD 0 INV
XU2 n2 n3 VDD 0 INV
XU3 VDD n4 n1 VDD 0 NAND2
XU4 n3 n5 VDD 0 INV
XU5 n5 n6 VDD 0 INV
XU6 n6 n7 VDD 0 INV
XU7 n7 n8 VDD 0 INV
XU8 n8 n9 VDD 0 INV
XU9 n9 n4 VDD 0 INV
* GA_IO OUT 0 n4
"""

def _build_ring31_io_netlist() -> str:
    """31 段リング + ga_out[0]/ga_in[0]（行跨ぎジャンパ I/O ストレス）。"""
    lines = [
        "* 31-stage ring + IN/OUT pads",
        "XU1 n1 n2 VDD 0 INV",
        "XU2 n2 n3 VDD 0 INV",
        "XU3 n32 n4 n1 VDD 0 NAND2",
    ]
    for i in range(4, 31):
        lines.append(f"XU{i} n{i} n{i + 1} VDD 0 INV")
    lines.extend(
        [
            "XU31 n31 n4 VDD 0 INV",
            "XU32 n4 n33 VDD 0 INV",
            "XU33 n33 n34 VDD 0 INV",
            "* GA_IO OUT 0 n34",
            "* GA_IO IN 0 n32",
        ]
    )
    return SPICE_PREAMBLE + "\n" + "\n".join(lines)


RING31_IO = _build_ring31_io_netlist()


def _build_ring_io_netlist(stages: int) -> str:
    """stages 段リング + ga_out[0]/ga_in[0]（35 ゲート超で複数行配置になる）。"""
    lines = [
        f"* {stages}-stage ring + IN/OUT pads (multi-row)",
        "XU1 n1 n2 VDD 0 INV",
        "XU2 n2 n3 VDD 0 INV",
        "XU3 n900 n4 n1 VDD 0 NAND2",
    ]
    for i in range(4, stages):
        lines.append(f"XU{i} n{i} n{i + 1} VDD 0 INV")
    lines.extend(
        [
            f"XU{stages} n{stages} n4 VDD 0 INV",
            f"XU{stages + 1} n4 n901 VDD 0 INV",
            f"XU{stages + 2} n901 n902 VDD 0 INV",
            "* GA_IO OUT 0 n902",
            "* GA_IO IN 0 n900",
        ]
    )
    return SPICE_PREAMBLE + "\n" + "\n".join(lines)


def _build_fanout_netlist(n: int) -> str:
    """1 本のネットが複数行に跨って多数のゲートへ分配される回路。"""
    lines = ["XU0 a b VDD 0 INV"]
    lines += [f"XU{i} b o{i} VDD 0 INV" for i in range(1, n)]
    lines.append("* GA_IO OUT 3 b")
    return SPICE_PREAMBLE + "\n" + "\n".join(lines)


def _build_mixed_netlist(n: int) -> str:
    """NAND2/NOR2/INV が離れたゲート同士を結ぶ（行跨ぎネット多数）。"""
    lines = []
    for i in range(n):
        k = i % 3
        if k == 0:
            lines.append(f"XU{i} m{i} m{(i + 5) % n} m{i + 1} VDD 0 NAND2")
        elif k == 1:
            lines.append(f"XU{i} m{i} m{(i + 7) % n} m{i + 1} VDD 0 NOR2")
        else:
            lines.append(f"XU{i} m{i} m{i + 1} VDD 0 INV")
    lines += ["* GA_IO IN 2 m0", f"* GA_IO OUT 1 m{n}"]
    return SPICE_PREAMBLE + "\n" + "\n".join(lines)

# SPICE プリアンブル内の .SUBCKT 定義はトップレベル GA インスタンスとして扱わない
PREAMBLE_WITH_DEFS = """
.SUBCKT NAND2 A B OUT VDD VSS
X_BC A B OUT _NAND2_NMID VSS OUT VDD OUT VDD VSS Z__GABASECELL
.ENDS
.SUBCKT NOR2 A B OUT VDD VSS
X_BC A B OUT VSS OUT OUT _NOR2_PMID VDD VDD VSS Z__GABASECELL
.ENDS
.SUBCKT INV IN OUT VDD VSS
X_BC IN IN OUT VSS OUT OUT VDD OUT VDD VSS Z__GABASECELL
.ENDS
"""


def test_preamble_subckts_ignored() -> None:
    netlist = PREAMBLE_WITH_DEFS + "\nXU1 a out VDD VSS INV\n.end\n"
    instances = parse_ga_instances(netlist)
    assert len(instances) == 1
    assert instances[0].ref == "U1"
    assert instances[0].subckt == "INV"


def test_internal_x_bc_not_top_level_instance() -> None:
    """X_BC 行がタイトル漏れ等でトップレベルにあっても配置対象にしない。"""
    netlist = (
        SPICE_PREAMBLE
        + "\nX_BC IN IN OUT VSS OUT OUT VDD OUT VDD VSS Z__GABASECELL\n"
        + "XU1 n1 n2 VDD 0 INV\n"
    )
    instances = parse_ga_instances(netlist)
    assert len(instances) == 1
    assert instances[0].ref == "U1"


def test_spice_preamble_matches_primitives() -> None:
    """テスト用 SPICE プリアンブルの X_BC 行が primitives.json と一致すること。"""
    import re

    from server.fab import load_primitive_catalog

    catalog = load_primitive_catalog()
    subckt_blocks = dict(
        re.findall(
            r"\.SUBCKT\s+(\w+)\s+[^\n]+\n(.*?)\.ENDS",
            SPICE_PREAMBLE,
            flags=re.DOTALL,
        )
    )
    for primitive in catalog.get("primitives", []):
        subckt = primitive.get("spiceSubckt")
        if subckt not in subckt_blocks:
            continue
        for gate in primitive.get("gates", []):
            expected = gate.get("spiceLine", "").strip()
            if not expected or "{" in expected:
                continue
            body = subckt_blocks[subckt]
            assert expected in body, (
                f"{subckt}: spiceLine mismatch\n"
                f"  primitives: {expected}\n"
                f"  preamble:   {body.strip()!r}"
            )


def test_gabasecell_ts_matches_primitives() -> None:
    """src/schematic/spice/gabasecell.ts の X_BC 行が primitives.json と一致すること。"""
    import re

    from server.fab import load_primitive_catalog

    ts_path = ROOT / "src" / "schematic" / "spice" / "gabasecell.ts"
    text = ts_path.read_text(encoding="utf-8")
    match = re.search(r"SPICE_PREAMBLE = `([\s\S]*?)`", text)
    assert match is not None, "SPICE_PREAMBLE not found in gabasecell.ts"
    preamble = match.group(1)
    subckt_blocks = dict(
        re.findall(
            r"\.SUBCKT\s+(\w+)\s+[^\n]+\n(.*?)\.ENDS",
            preamble,
            flags=re.DOTALL,
        )
    )
    catalog = load_primitive_catalog()
    for primitive in catalog.get("primitives", []):
        subckt = primitive.get("spiceSubckt")
        if subckt not in subckt_blocks:
            continue
        for gate in primitive.get("gates", []):
            expected = gate.get("spiceLine", "").strip()
            if not expected or "{ref}" in expected:
                continue
            body = subckt_blocks[subckt]
            assert expected in body, (
                f"{subckt}: gabasecell.ts spiceLine mismatch\n"
                f"  primitives: {expected}\n"
                f"  gabasecell: {body.strip()!r}"
            )


def _assert_sync(
    name: str,
    netlist: str,
    *,
    expected_gates: int,
    out_name: str,
    max_attempts: int = 24,
) -> dict:
    out = ROOT / "public" / "generated" / out_name
    gf.clear_cache()
    info = sync_ga_layout(netlist, out, max_attempts=max_attempts)
    assert out.is_file(), f"{name}: overlay GDS not written"
    assert info["gates_placed"] == expected_gates, (
        f"{name}: expected {expected_gates} gates, got {info['gates_placed']}"
    )
    assert info["wire_segments"] >= 1, f"{name}: no wire segments"
    assert info.get("verified"), f"{name}: layout not verified"
    return info


def test_inv_chain_sync() -> None:
    instances = parse_ga_instances(INV_CHAIN)
    assert len(instances) == 2
    problem = build_layout_problem(instances)
    assert len(problem.gate_slots) == 2
    info = _assert_sync(
        "INV Chain",
        INV_CHAIN,
        expected_gates=2,
        out_name="test_inv_chain.gds",
    )
    print("INV Chain ok", info)


def test_inv_nand2_sync() -> None:
    instances = parse_ga_instances(INV_NAND2)
    assert len(instances) == 2
    problem = build_layout_problem(instances)
    # NAND2 は 1 ベースセル構成（primitives.json の gateCount に追従）
    expected = sum(
        len(_primitive_gates(inst.subckt)) for inst in instances
    )
    assert len(problem.gate_slots) == expected
    info = _assert_sync(
        "INV+NAND2",
        INV_NAND2,
        expected_gates=expected,
        out_name="test_inv_nand2.gds",
    )
    print("INV+NAND2 ok", info)


def _primitive_gates(subckt: str) -> list:
    from server.fab import get_primitive_by_subckt

    primitive = get_primitive_by_subckt(subckt)
    return primitive.get("gates", []) if primitive else []


def test_inv_chain_3x_sync() -> None:
    instances = parse_ga_instances(INV_CHAIN_3X)
    assert len(instances) == 3
    problem = build_layout_problem(instances)
    assert len(problem.gate_slots) == 3
    info = _assert_sync(
        "INV Chain 3x",
        INV_CHAIN_3X,
        expected_gates=3,
        out_name="test_inv_chain_3x.gds",
    )
    print("INV Chain 3x ok", info)


def test_inv_chain_3x_n2_n3_clearance() -> None:
    """3×INV で g:n2 と g:n3 の水平配線が接触・短絡しないこと。"""
    from server.ga_obstacles import WIRE_CLEARANCE_UM
    from server.ga_router import _parallel_horizontal_edge_gap

    instances = parse_ga_instances(INV_CHAIN_3X_PULSE)
    assert len(instances) == 3
    info = _assert_sync(
        "INV Chain 3x pulse",
        INV_CHAIN_3X_PULSE,
        expected_gates=3,
        out_name="test_inv_chain_3x_pulse.gds",
    )
    # 配線結果を再取得して n2/n3 水平クリアランスを検証
    _, power, signal = _route_for_check(INV_CHAIN_3X_PULSE, info["seed"])
    segments = power + signal

    n2 = [s for s in segments if s.net_key == "g:n2"]
    n3 = [s for s in segments if s.net_key == "g:n3"]
    for a in n2:
        for b in n3:
            gap = _parallel_horizontal_edge_gap(a, b)
            if gap is not None:
                assert gap >= WIRE_CLEARANCE_UM - 1e-6, (
                    f"n2/n3 clearance {gap:.2f} µm < {WIRE_CLEARANCE_UM} µm: "
                    f"{a.x0},{a.y0}-{a.x1},{a.y1} vs {b.x0},{b.y0}-{b.x1},{b.y1}"
                )
    print("INV Chain 3x n2/n3 clearance ok", info)


def _route_for_check(netlist: str, seed: int):
    """指定 seed で配置・配線を再現し (grid, power_segments, signal_segments) を返す。"""
    import random

    from server.fab import get_base_gds_path, load_gate_array_catalog
    from server.ga_extract import build_layout_problem
    from server.ga_grid_router import PaintGrid
    from server.ga_obstacles import load_m5_obstacle_boxes
    from server.ga_placement import place_gates_once
    from server.ga_global_route import (
        classify_global_nets,
        endpoint_pad_cells,
        register_global_routing_infrastructure,
    )
    from server.ga_io_pads import parse_io_pad_bindings
    from server.ga_sync import (
        _register_signal_pads,
        _route_power_nets,
        _route_signal_nets,
    )
    from server.ga_terminals import assign_endpoint_coordinates

    instances = parse_ga_instances(netlist)
    io_bindings = parse_io_pad_bindings(netlist)
    catalog = load_gate_array_catalog()
    problem = build_layout_problem(instances)
    rows = int(catalog.get("gateArray", {}).get("rows", 9))
    plan = place_gates_once(problem, catalog, seed=seed, allow_split=seed >= rows)
    assert plan is not None
    assign_endpoint_coordinates(problem, plan.placed, catalog)
    global_nets = classify_global_nets(problem, io_bindings)
    grid = PaintGrid(
        tuple(catalog["baseGds"]["bbox"]),
        load_m5_obstacle_boxes(get_base_gds_path()),
    )
    grid.set_global_nets(global_nets)
    _register_signal_pads(problem, grid, global_nets)
    register_global_routing_infrastructure(grid, plan.placed, catalog)
    power = _route_power_nets(problem, plan.placed, catalog, grid)
    rng = random.Random(seed) if seed > 0 else None
    signal = _route_signal_nets(
        problem, grid, global_nets, catalog=catalog, placed=plan.placed, rng=rng
    )
    assert signal is not None
    return grid, power, signal


def _assert_no_signal_conflicts(name: str, netlist: str, seed: int) -> None:
    """信号配線同士が交差・接触（辺間 5 µm 未満）しないことを検証する。"""
    from server.ga_obstacles import WIRE_CLEARANCE_UM
    from server.ga_router import _bbox_edge_gap, _segment_bbox

    _, _, signal = _route_for_check(netlist, seed)
    for i, a in enumerate(signal):
        for b in signal[i + 1 :]:
            if a.net_key == b.net_key:
                continue
            gap = _bbox_edge_gap(_segment_bbox(a), _segment_bbox(b))
            assert gap >= WIRE_CLEARANCE_UM - 1e-6, (
                f"{name}: {a.net_key} と {b.net_key} が近接/交差 (gap={gap:.2f} µm): "
                f"({a.x0},{a.y0})-({a.x1},{a.y1}) vs ({b.x0},{b.y0})-({b.x1},{b.y1})"
            )


def _assert_nets_connected(name: str, netlist: str, seed: int) -> None:
    """全信号ネットの全ピンが配線（塗りつぶしセル）で電気的に連結していることを検証。

    導体になるのは塗りつぶされたセルのみ。ピンは自列のパッドセルが塗られて
    初めて接続とみなす（隣接セルは辺間 5 µm 空くため未接続）。同一ピン列の
    複数トラック段パッドは下層で導通しているため、塗られたパッド同士は
    列単位で連結扱いにする。
    """
    from collections import deque

    from server.fab import load_gate_array_catalog
    from server.ga_placement import place_gates_once
    from server.ga_global_route import classify_global_nets, endpoint_check_pad_cells
    from server.ga_io_pads import parse_io_pad_bindings
    from server.ga_terminals import assign_endpoint_coordinates, net_kind

    grid, _, _ = _route_for_check(netlist, seed)
    catalog = load_gate_array_catalog()
    problem = build_layout_problem(parse_ga_instances(netlist))
    io_bindings = parse_io_pad_bindings(netlist)
    global_nets = classify_global_nets(problem, io_bindings)
    rows = int(catalog.get("gateArray", {}).get("rows", 9))
    plan = place_gates_once(problem, catalog, seed=seed, allow_split=seed >= rows)
    assert plan is not None
    assign_endpoint_coordinates(problem, plan.placed, catalog)

    for net_key, eps in problem.net_groups.items():
        if net_kind(net_key) != "signal":
            continue
        pad_groups = [
            (
                f"{ep.component_ref}/{ep.gate_instance}/{ep.gate_pin}",
                endpoint_check_pad_cells(grid, ep, global_nets),
            )
            for ep in eps
        ]
        if len(pad_groups) < 2:
            continue
        painted = grid.painted_cells(net_key)

        # 各ピンは塗られたパッドを最低 1 つ持つこと
        unpainted = [nm for nm, pg in pad_groups if not (pg & painted)]
        assert not unpainted, (
            f"{name}: {net_key} のパッドが未配線: {unpainted}"
        )

        # 塗りセルの 4 近傍 + 同一ピン列の塗られたパッド間（下層導通）で BFS
        col_links: dict[tuple[int, int], set[tuple[int, int]]] = {}
        for _, pg in pad_groups:
            painted_pads = pg & painted
            for c in painted_pads:
                col_links.setdefault(c, set()).update(
                    x for x in painted_pads if x != c
                )
        start = next(iter(pad_groups[0][1] & painted))
        seen = {start}
        queue = deque([start])
        while queue:
            c = queue.popleft()
            neighbors = [
                (c[0] + 1, c[1]),
                (c[0] - 1, c[1]),
                (c[0], c[1] + 1),
                (c[0], c[1] - 1),
            ] + list(col_links.get(c, ()))
            for partner in grid._jumpers.get(c, ()):
                if partner in painted:
                    neighbors.append(partner)
            for nb in neighbors:
                if nb in painted and nb not in seen:
                    seen.add(nb)
                    queue.append(nb)
        unreached = [nm for nm, pg in pad_groups if not (pg & seen)]
        assert not unreached, f"{name}: {net_key} が未接続: {unreached}"


def test_inv_chain_io11_sync() -> None:
    """2×INV チェーン → ga_out[11]（遠方行 I/O、seed 0 で成功すること）。"""
    info = _assert_sync(
        "INV Chain IO11",
        INV_CHAIN_IO11,
        expected_gates=2,
        out_name="test_inv_io11.gds",
        max_attempts=8,
    )
    assert info["io_pads"] == 1

    # パッド (5797, 2155) まで到達していること
    from server.fab import load_gate_array_catalog, get_base_gds_path
    from server.ga_obstacles import load_m5_obstacle_boxes
    from server.ga_grid_router import PaintGrid
    from server.ga_placement import place_gates_once
    from server.ga_io_pads import parse_io_pad_bindings, route_io_pads, GA_OUT_PADS
    from server.ga_global_route import classify_global_nets, register_global_routing_infrastructure
    from server.ga_sync import _register_signal_pads, _route_power_nets, _route_signal_nets
    from server.ga_terminals import assign_endpoint_coordinates

    catalog = load_gate_array_catalog()
    problem = build_layout_problem(parse_ga_instances(INV_CHAIN_IO11))
    io_bindings = parse_io_pad_bindings(INV_CHAIN_IO11)
    global_nets = classify_global_nets(problem, io_bindings)
    plan = place_gates_once(problem, catalog, seed=info["seed"])
    assign_endpoint_coordinates(problem, plan.placed, catalog)
    grid = PaintGrid(tuple(catalog["baseGds"]["bbox"]), load_m5_obstacle_boxes(get_base_gds_path()))
    grid.set_global_nets(global_nets)
    _register_signal_pads(problem, grid, global_nets)
    register_global_routing_infrastructure(grid, plan.placed, catalog)
    _route_power_nets(problem, plan.placed, catalog, grid)
    signal = _route_signal_nets(
        problem, grid, global_nets, catalog=catalog, placed=plan.placed
    )
    io = route_io_pads(grid, problem, io_bindings, catalog=catalog, global_nets=global_nets, path_id_start=100)
    assert io is not None
    pad_x, pad_y = GA_OUT_PADS[11]
    ends = {(round(s.x1, 1), round(s.y1, 1)) for s in io}
    assert (pad_x, pad_y) in ends, f"I/O wire must end at pad, got {ends}"
    _assert_nets_connected("INV Chain IO11", INV_CHAIN_IO11, info["seed"])
    print("INV Chain IO11 ok", info)


def test_inv_chain_nand_ring_io_sync() -> None:
    """2×INV + NAND2 リング + ga_out[0] on n3（同一行グローバル配線）。"""
    info = _assert_sync(
        "INV Chain NAND ring IO",
        INV_CHAIN_NAND_RING_IO,
        expected_gates=3,
        out_name="test_inv_nand_ring_io.gds",
        max_attempts=72,
    )
    assert info["io_pads"] == 1
    _assert_nets_connected(
        "INV Chain NAND ring IO", INV_CHAIN_NAND_RING_IO, info["seed"]
    )
    print("INV Chain NAND ring IO ok", info)


def test_default_loop_io_sync() -> None:
    """デフォルト回路: 9 ゲート NAND2+INV リング + ga_out[0]。"""
    info = _assert_sync(
        "Default loop IO",
        DEFAULT_LOOP_IO,
        expected_gates=9,
        out_name="test_default_loop_io.gds",
        max_attempts=72,
    )
    assert info["io_pads"] == 1
    _assert_nets_connected("Default loop IO", DEFAULT_LOOP_IO, info["seed"])
    print("Default loop IO ok", info)


def test_ring31_io_sync() -> None:
    """31 段リング + IN/OUT パッド（rowCrossing ジャンパ経由の行跨ぎ I/O）。"""
    info = _assert_sync(
        "31-stage ring IO",
        RING31_IO,
        expected_gates=33,
        out_name="test_ring31_io.gds",
        max_attempts=12,
    )
    assert info["io_pads"] == 2
    _assert_nets_connected("31-stage ring IO", RING31_IO, info["seed"])
    print("31-stage ring IO ok", info)


def test_inv_io_out_sync() -> None:
    """I/O パッド配線: グリッド左域 + X=5700 以降オフグリッド Manhattan。"""
    from server.ga_io_pads import IO_BOUNDARY_X_UM, parse_io_pad_bindings

    bindings = parse_io_pad_bindings(INV_IO_OUT)
    assert len(bindings) == 1
    pad_x, pad_y = bindings[0].pad_xy()
    info = _assert_sync(
        "INV I/O OUT",
        INV_IO_OUT,
        expected_gates=1,
        out_name="test_inv_io_out.gds",
    )
    assert info["io_pads"] == 1
    assert info["wire_segments"] >= 3
    print("INV I/O OUT ok", info, f"pad=({pad_x},{pad_y})", f"boundary={IO_BOUNDARY_X_UM}")


def test_signal_wires_never_conflict() -> None:
    """全回路で信号配線同士の交差・接触ゼロを検証。"""
    for name, netlist, gates, out_name in (
        ("INV Chain", INV_CHAIN, 2, "test_conflict_2x.gds"),
        ("INV+NAND2", INV_NAND2, 2, "test_conflict_nand2.gds"),
        ("INV Chain 3x", INV_CHAIN_3X, 3, "test_conflict_3x.gds"),
    ):
        info = _assert_sync(name, netlist, expected_gates=gates, out_name=out_name)
        _assert_no_signal_conflicts(name, netlist, info["seed"])
        _assert_nets_connected(name, netlist, info["seed"])
        print(f"{name} no-conflict ok", info)


def test_multi_row_ring_io_sync() -> None:
    """35 ゲート超のリング + I/O（2〜3 行配置、行跨ぎはジャンパ経由）。"""
    for stages in (34, 60, 80):
        netlist = _build_ring_io_netlist(stages)
        info = _assert_sync(
            f"ring{stages} IO",
            netlist,
            expected_gates=stages + 2,
            out_name=f"test_ring{stages}_io.gds",
            max_attempts=12,
        )
        assert len(info["placement_rows"]) >= 2, info["placement_rows"]
        assert info["io_pads"] == 2
        print(f"ring{stages} IO ok", info["seed"], info["placement_rows"].keys())


def test_multi_row_fanout_and_mixed_sync() -> None:
    """複数行に跨る多分岐ネット・ランダム結線（NAND2/NOR2/INV）。"""
    for name, netlist, gates in (
        ("fanout80", _build_fanout_netlist(80), 80),
        ("mixed60", _build_mixed_netlist(60), 60),
    ):
        info = _assert_sync(
            name,
            netlist,
            expected_gates=gates,
            out_name=f"test_{name}.gds",
            max_attempts=12,
        )
        assert len(info["placement_rows"]) >= 2
        print(f"{name} ok", info["seed"])


def test_verifier_detects_short_and_open() -> None:
    """独立検証器が短絡・開放を検出すること（検証自体が空振りしていないか）。"""
    import server.ga_sync as ga_sync
    from server.ga_router import WireSegment

    captured: dict = {}
    original = ga_sync.verify_routing

    def spy(segments, *args, **kwargs):
        captured["call"] = (list(segments), args, kwargs)
        return original(segments, *args, **kwargs)

    ga_sync.verify_routing = spy
    try:
        _assert_sync(
            "ring40 IO (verifier)",
            _build_ring_io_netlist(40),
            expected_gates=42,
            out_name="test_verifier.gds",
            max_attempts=12,
        )
    finally:
        ga_sync.verify_routing = original
    segments, args, kwargs = captured["call"]
    assert original(segments, *args, **kwargs).ok

    n10 = [i for i, s in enumerate(segments) if s.net_key == "g:n10"]
    broken = [s for i, s in enumerate(segments) if i != n10[len(n10) // 2]]
    report = original(broken, *args, **kwargs)
    assert any("g:n10" in m for m in report.opens), report.errors()

    a = segments[n10[0]]
    b = next(s for s in segments if s.net_key == "g:n11")
    shorted = segments + [
        WireSegment(a.x0, a.y0, b.x0, a.y0, 5.0, "g:n10", 99999),
        WireSegment(b.x0, a.y0, b.x0, b.y0, 5.0, "g:n10", 99999),
    ]
    report = original(shorted, *args, **kwargs)
    assert any("g:n10" in m and "g:n11" in m for m in report.shorts), report.errors()
    print("verifier short/open detection ok")


def test_invalid_io_pad_lines_rejected() -> None:
    """範囲外・重複・方向違いの GA_IO 行は黙って無視せずエラーにする。"""
    from server.ga_io_pads import parse_io_pad_bindings

    ok = parse_io_pad_bindings("* GA_IO IN 12 a\n* GA_IO OUT 0 b\n")
    assert [(b.direction, b.index, b.net) for b in ok] == [("IN", 12, "a"), ("OUT", 0, "b")]
    for bad in (
        "* GA_IO IN 13 a",
        "* GA_IO OUT -1 a",
        "* GA_IO IN x a",
        "* GA_IO INOUT 0 a",
        "* GA_IO IN 0 a\n* GA_IO IN 0 b",
    ):
        try:
            parse_io_pad_bindings(bad)
        except RuntimeError:
            continue
        raise AssertionError(f"accepted invalid GA_IO: {bad!r}")


def test_layout_tiles_render() -> None:
    """サーバ側のレイアウト描画: 範囲・レイヤ・タイル・マスク付きの画像が返る。"""
    from server.layout_view import LayoutRenderer, layer_mask_for_test

    r = LayoutRenderer()
    info = r.info()
    assert info["bbox"][2] > info["bbox"][0] and info["layers"], info
    png = r.tile(14, 0, 0, None)
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 1000
    hidden = r.tile(14, 0, 0, layer_mask_for_test(len(info["layers"]), {0}))
    assert hidden != png, "hiding METAL4 must change the tile"
    img = r.image((0.0, 0.0, 800.0, 600.0), 400, 300, None)
    assert img[:4] == b"\x89PNG"
    try:
        r.tile(-1, 0, 0, None)
    except ValueError:
        pass
    else:
        raise AssertionError("negative level accepted")


def main() -> None:
    test_preamble_subckts_ignored()
    test_internal_x_bc_not_top_level_instance()
    test_spice_preamble_matches_primitives()
    test_gabasecell_ts_matches_primitives()
    test_inv_chain_sync()
    test_inv_chain_3x_sync()
    test_inv_chain_3x_n2_n3_clearance()
    test_inv_nand2_sync()
    test_inv_io_out_sync()
    test_inv_chain_io11_sync()
    test_inv_chain_nand_ring_io_sync()
    test_default_loop_io_sync()
    test_ring31_io_sync()
    test_signal_wires_never_conflict()
    test_multi_row_ring_io_sync()
    test_multi_row_fanout_and_mixed_sync()
    test_verifier_detects_short_and_open()
    test_invalid_io_pad_lines_rejected()
    test_layout_tiles_render()
    print("all ga layout tests passed")


if __name__ == "__main__":
    main()
