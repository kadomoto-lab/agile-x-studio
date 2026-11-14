"""行跨ぎ・I/O 向けグローバル配線メタデータとジャンパ登録。

VDD (y=135) / VSS (y=15) バスは各セル行を横断するため、別行の端子や
I/O パッドへ接続するネットは VDD/VSS をまたぐ Y=5 / Y=145 端子から
引き出す。同一 X の Y=5↔Y=145 は低層メタル（ジャンパ）で接続され、
METAL5 では Y=5 と Y=145 の間を配線してはならない。
"""

from __future__ import annotations

from server.fab import get_base_gds_path
from server.ga_extract import LayoutProblem
from server.ga_grid_router import PaintGrid
from server.ga_obstacles import load_jumper_pairs
from server.ga_placement import PlacedGate, _cell_lookup
from server.ga_terminals import (
    ROW_CROSSING_Y,
    ROUTING_TRACKS,
    global_routing_from_catalog,
    net_kind,
    signal_track_y,
)

# re-export for ga_io_pads / tests
__all__ = [
    "classify_global_nets",
    "endpoint_access_tracks",
    "endpoint_check_pad_cells",
    "endpoint_escape_pad_cells",
    "endpoint_pad_cells",
    "endpoint_registered_tracks",
    "global_row_bands",
    "global_row_crossing_ys",
    "is_global_signal_net",
    "register_global_routing_infrastructure",
]


def is_global_signal_net(net_key: str, global_nets: set[str]) -> bool:
    return net_key in global_nets and net_kind(net_key) == "signal"


def global_row_bands(catalog: dict) -> tuple[tuple[float, float], ...]:
    """各 GA 行セル内で垂直移動可能な Y 帯 [µm]（行間ギャップは含まない）。"""
    ga = catalog.get("gateArray", {})
    grid_meta = catalog.get("grid", {})
    rows = int(ga.get("rows", 9))
    oy0 = float(grid_meta.get("origin", {}).get("y", 100.0))
    pitch_y = float(grid_meta.get("pitch", {}).get("y", 580.0))
    site_h = float(grid_meta.get("siteSize", {}).get("height", 150.0))
    return tuple(
        (oy0 + row * pitch_y + 1.0, oy0 + row * pitch_y + site_h - 1.0)
        for row in range(rows)
    )


def global_row_crossing_ys(catalog: dict) -> tuple[float, ...]:
    """全 GA 行の rowCrossingY 絶対座標 [µm]。"""
    ga = catalog.get("gateArray", {})
    grid_meta = catalog.get("grid", {})
    rows = int(ga.get("rows", 9))
    oy0 = float(grid_meta.get("origin", {}).get("y", 100.0))
    pitch_y = float(grid_meta.get("pitch", {}).get("y", 580.0))
    gr = global_routing_from_catalog(catalog)
    local_ys = tuple(gr.get("rowCrossingY", ROW_CROSSING_Y))
    out: list[float] = []
    for row in range(rows):
        oy = oy0 + row * pitch_y
        for ly in local_ys:
            out.append(round(oy + ly, 3))
    return tuple(out)


def classify_global_nets(
    problem: LayoutProblem,
    io_bindings: list,
) -> set[str]:
    """行跨ぎまたは I/O 接続が必要な信号ネット。"""
    global_nets: set[str] = {b.net_key for b in io_bindings}
    for net_key, endpoints in problem.net_groups.items():
        if net_kind(net_key) != "signal":
            continue
        rows = {round(ep.origin_y, 3) for ep in endpoints}
        if len(rows) > 1:
            global_nets.add(net_key)
    return global_nets


def endpoint_access_tracks(net_key: str, global_nets: set[str]) -> tuple[float, ...]:
    """ネット種別に応じた端子 Y トラック（セルローカル [µm]）。"""
    if net_key in global_nets:
        return ROW_CROSSING_Y
    return ROUTING_TRACKS


def endpoint_pad_cells(
    grid: PaintGrid,
    ep,
    global_nets: set[str],
) -> set[tuple[int, int]]:
    tracks = endpoint_access_tracks(ep.net_key, global_nets)
    return {grid.cell_of(ep.x, ep.origin_y + track) for track in tracks}


def endpoint_check_pad_cells(
    grid: PaintGrid,
    ep,
    global_nets: set[str],
) -> set[tuple[int, int]]:
    """接続性検証用: _register_signal_pads と同じトラック集合。"""
    tracks = endpoint_registered_tracks(ep, global_nets)
    return {grid.cell_of(ep.x, ep.origin_y + track) for track in tracks}


def endpoint_registered_tracks(ep, global_nets: set[str]) -> tuple[float, ...]:
    """端子パッドとして登録する Y（ローカル [µm]）。

    ピン列の各段パッドは下層で導通しているため、どのネットのピンでも
    rowCrossing (Y=5/145) パッドは同ネット専用。行内配線が混雑したときの
    行間ギャップへの逃げ道として、非グローバルネットにも登録しておく。
    """
    tracks = endpoint_access_tracks(ep.net_key, global_nets)
    if ep.net_key in global_nets:
        pin_track = signal_track_y(ep.gate_pin)
        return tuple(dict.fromkeys((*tracks, pin_track)))
    return tuple(dict.fromkeys((*tracks, *ROW_CROSSING_Y)))


def endpoint_escape_pad_cells(grid: PaintGrid, ep) -> set[tuple[int, int]]:
    """ピン列の rowCrossing (Y=5/145) パッド — 行間ギャップへの出入口。"""
    return {grid.cell_of(ep.x, ep.origin_y + y) for y in ROW_CROSSING_Y}


def register_global_routing_infrastructure(
    grid: PaintGrid,
    placed: list[PlacedGate],
    catalog: dict,
) -> None:
    """全 GA サイトのジャンパと行跨ぎルールをグリッドに登録する。

    - セル内ジャンパ (Y=5↔145): A* 上のテレポートのみ（METAL5 は描かない）
    - 行間 (上行 Y=145 → 下行 Y=5): I/O 配線では METAL5 グリッド（ジャンパ列）
    - グローバル信号: 行内は routingTracks / rowCrossingY 間の垂直移動可。
      行間はジャンパ列 METAL5 + 低層ジャンパのみ。
    """
    del placed
    gr = global_routing_from_catalog(catalog)
    jumper_x: tuple[float, ...] = tuple(gr["jumperPinX"])
    row_cross_y: tuple[float, float] = tuple(gr["rowCrossingY"])
    y_lo, y_hi = row_cross_y[0], row_cross_y[1]

    crossing_ys = global_row_crossing_ys(catalog)
    grid.set_global_routing_context(
        frozenset(crossing_ys),
        row_bands=global_row_bands(catalog),
    )

    cells = _cell_lookup(catalog)

    for (_row, _col), cell in cells.items():
        ox = float(cell["origin"]["x"])
        oy = float(cell["origin"]["y"])
        for jx in jumper_x:
            x = ox + jx
            c_lo = grid.cell_of(x, oy + y_lo)
            c_hi = grid.cell_of(x, oy + y_hi)
            if grid.in_bounds(c_lo) and grid.in_bounds(c_hi):
                grid.register_jumper(c_lo, c_hi)

    # base.gds の全 JUMPLINE（サイト内 Y=5↔145 + 行間ギャップの 40 µm 縦ジャンパ）
    gap_pairs: list[tuple[tuple[int, int], tuple[int, int]]] = []
    for p0, p1 in load_jumper_pairs(get_base_gds_path()):
        c0 = grid.cell_of(*p0)
        c1 = grid.cell_of(*p1)
        grid.register_jumper(c0, c1)
        gap_pairs.append((c0, c1))

    grid.set_horizontal_penalties(
        _horizontal_penalties(grid, catalog, gap_pairs, (y_lo, y_hi))
    )


# 行間ギャップで水平配線を引くときの追加コスト
ACCESS_ROW_PENALTY = 1.0
UNHOPPABLE_ROW_PENALTY = 0.3


def _horizontal_penalties(
    grid: PaintGrid,
    catalog: dict,
    jumper_pairs: list[tuple[tuple[int, int], tuple[int, int]]],
    row_crossing: tuple[float, float],
) -> dict[int, float]:
    """gy → 水平移動の追加コスト。

    - 端子行 (Y=5/145) と、その外側に隣接するギャップ行は端子へ出入りする
      垂直配線の通り道。ここを水平に塞ぐと他ネットが端子に到達できなくなる。
    - ギャップ内でも 40 µm 縦ジャンパが跨げない行を水平に塞ぐと、垂直方向の
      通り抜けが不可能になる。ジャンパで跨げる行へ水平配線を誘導する。
    """
    bands = global_row_bands(catalog)
    in_band: set[int] = set()
    for y0, y1 in bands:
        gy0 = grid.cell_of(0.0, y0)[1]
        gy1 = grid.cell_of(0.0, y1)[1]
        in_band.update(range(gy0, gy1 + 1))

    hoppable: set[int] = set()
    for (gx0, gy0), (gx1, gy1) in jumper_pairs:
        if gx0 != gx1 or abs(gy0 - gy1) < 2:
            continue
        lo, hi = sorted((gy0, gy1))
        if lo in in_band or hi in in_band:
            continue
        hoppable.update(range(lo + 1, hi))

    penalties: dict[int, float] = {}
    if bands:
        gap_lo = grid.cell_of(0.0, bands[0][1])[1] + 1
        gap_hi = grid.cell_of(0.0, bands[-1][0])[1] - 1
        for gy in range(gap_lo, gap_hi + 1):
            if gy not in in_band and gy not in hoppable:
                penalties[gy] = UNHOPPABLE_ROW_PENALTY

    y_lo, y_hi = row_crossing
    for y_band_lo, _y_band_hi in bands:
        oy = y_band_lo - 1.0
        gy_pad_lo = grid.cell_of(0.0, oy + y_lo)[1]
        gy_pad_hi = grid.cell_of(0.0, oy + y_hi)[1]
        for gy in (gy_pad_lo, gy_pad_lo - 1, gy_pad_hi, gy_pad_hi + 1):
            if 0 <= gy < grid.ny:
                penalties[gy] = ACCESS_ROW_PENALTY
    return penalties
