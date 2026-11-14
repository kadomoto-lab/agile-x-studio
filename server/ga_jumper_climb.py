"""ジャンパ列 METAL5 行昇降（I/O 配線・global 信号行跨ぎ共通）。"""

from __future__ import annotations

from dataclasses import dataclass

from server.ga_grid_router import PaintGrid, path_to_segments
from server.ga_placement import PlacedGate, _cell_lookup
from server.ga_router import WireSegment
from server.ga_terminals import ROW_CROSSING_Y, global_routing_from_catalog


@dataclass(frozen=True)
class GaSite:
    row: int
    col: int
    ox: float
    oy: float
    gx_lo: int
    gx_hi: int
    gy_lo: int
    gy_hi: int


def row_origin_y(row: int, catalog: dict) -> float:
    grid_meta = catalog.get("grid", {})
    oy0 = float(grid_meta.get("origin", {}).get("y", 100.0))
    pitch_y = float(grid_meta.get("pitch", {}).get("y", 580.0))
    return oy0 + row * pitch_y


def ga_site_for_row_col(
    grid: PaintGrid,
    row: int,
    col: int,
    catalog: dict,
) -> GaSite | None:
    cell = _cell_lookup(catalog).get((row, col))
    if cell is None:
        return None
    grid_meta = catalog.get("grid", {})
    pitch_x = float(grid_meta.get("pitch", {}).get("x", 160.0))
    site_h = float(grid_meta.get("siteSize", {}).get("height", 150.0))
    ox = float(cell["origin"]["x"])
    oy = float(cell["origin"]["y"])
    return GaSite(
        row,
        col,
        ox,
        oy,
        grid.cell_of(ox + 1.0, 0.0)[0],
        grid.cell_of(ox + pitch_x - 1.0, 0.0)[0],
        grid.cell_of(0.0, oy + 1.0)[1],
        grid.cell_of(0.0, oy + site_h - 1.0)[1],
    )


def ga_site_for_gate(
    grid: PaintGrid,
    pg: PlacedGate,
    catalog: dict,
) -> GaSite | None:
    return ga_site_for_row_col(grid, pg.row, pg.col, catalog)


def vertical_crosses_power_bus(
    y0: float,
    y1: float,
    catalog: dict,
) -> bool:
    y_lo, y_hi = sorted((y0, y1))
    if y_hi - y_lo < 1e-6:
        return False
    gr = global_routing_from_catalog(catalog)
    ga = catalog.get("gateArray", {})
    grid_meta = catalog.get("grid", {})
    rows = int(ga.get("rows", 9))
    oy0 = float(grid_meta.get("origin", {}).get("y", 100.0))
    pitch_y = float(grid_meta.get("pitch", {}).get("y", 580.0))
    vss = float(gr["vssBusY"])
    vdd = float(gr["vddBusY"])
    for row in range(rows):
        oy = oy0 + row * pitch_y
        for bus_y in (oy + vss, oy + vdd):
            if y_lo + 1e-6 < bus_y < y_hi - 1e-6:
                return True
    return False


def _jumper_cells(
    grid: PaintGrid,
    ox: float,
    oy: float,
    catalog: dict,
    *,
    upper: bool,
) -> set[tuple[int, int]]:
    gr = global_routing_from_catalog(catalog)
    y_local = ROW_CROSSING_Y[1] if upper else ROW_CROSSING_Y[0]
    out: set[tuple[int, int]] = set()
    for jx in gr["jumperPinX"]:
        c = grid.cell_of(ox + jx, oy + y_local)
        if grid.in_bounds(c):
            out.add(c)
    return out


def _row_jumper_goals(
    grid: PaintGrid,
    catalog: dict,
    row: int,
    *,
    upper: bool,
    col: int | None = None,
) -> set[tuple[int, int]]:
    goals: set[tuple[int, int]] = set()
    for (r, c), cell in _cell_lookup(catalog).items():
        if r != row:
            continue
        if col is not None and c != col:
            continue
        ox = float(cell["origin"]["x"])
        oy = float(cell["origin"]["y"])
        goals |= _jumper_cells(grid, ox, oy, catalog, upper=upper)
    return {c for c in goals if grid.in_bounds(c)}


def _route_to_jumper_on_row(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    row: int,
    catalog: dict,
    path_id: int,
    *,
    upper: bool,
    col: int | None = None,
) -> tuple[list[WireSegment], set[tuple[int, int]], int] | None:
    goals = _row_jumper_goals(grid, catalog, row, upper=upper, col=col)
    if not goals:
        return None
    if starts & goals:
        return [], starts & goals, path_id
    # ジャンパパッドは未使用なら passable。他ネット占有セルをゴールにしない
    # （以前は非 passable なゴールを obstacle_goals として許可しており短絡し得た）
    obstacle_goals: set[tuple[int, int]] = set()
    result = grid.route_and_paint(
        net_key,
        starts,
        goals,
        path_id=path_id,
        intra_cell_routing=True,
        obstacle_goals=obstacle_goals,
    )
    if result is None:
        return None
    segs, path = result
    if not path:
        return None
    return segs, {path[-1]}, path_id + (1 if segs else 0)


def route_site_to_jumper(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    site: GaSite,
    catalog: dict,
    path_id: int,
    *,
    upper: bool,
) -> tuple[list[WireSegment], set[tuple[int, int]], int] | None:
    goals = _jumper_cells(grid, site.ox, site.oy, catalog, upper=upper)
    goals = {
        c
        for c in goals
        if site.gx_lo <= c[0] <= site.gx_hi and site.gy_lo <= c[1] <= site.gy_hi
    }
    if not goals:
        return None
    if starts & goals:
        return [], starts, path_id
    # ジャンパパッドは未使用なら passable。他ネット占有セルをゴールにしない
    # （以前は非 passable なゴールを obstacle_goals として許可しており短絡し得た）
    obstacle_goals: set[tuple[int, int]] = set()
    result = grid.route_bounded_and_paint(
        net_key,
        starts,
        goals,
        gx_lo=site.gx_lo,
        gx_hi=site.gx_hi,
        gy_lo=site.gy_lo,
        gy_hi=site.gy_hi,
        path_id=path_id,
        obstacle_goals=obstacle_goals,
        intra_cell_routing=True,
    )
    if result is None:
        return None
    segs, path = result
    if not path:
        return None
    return segs, {path[-1]}, path_id + (1 if segs else 0)


def _local_jx_for_gx(
    grid: PaintGrid,
    ox: float,
    gx: int,
    catalog: dict,
) -> float | None:
    gr = global_routing_from_catalog(catalog)
    for jx in gr["jumperPinX"]:
        if grid.cell_of(ox + jx, 0.0)[0] == gx:
            return float(jx)
    return None


def _site_col_for_gx(
    grid: PaintGrid,
    gx: int,
    row: int,
    catalog: dict,
) -> tuple[int, float] | None:
    grid_meta = catalog.get("grid", {})
    pitch_x = float(grid_meta.get("pitch", {}).get("x", 160.0))
    for (_r, col), cell in _cell_lookup(catalog).items():
        if _r != row:
            continue
        ox = float(cell["origin"]["x"])
        gx_lo = grid.cell_of(ox + 1.0, 0.0)[0]
        gx_hi = grid.cell_of(ox + pitch_x - 1.0, 0.0)[0]
        if gx_lo <= gx <= gx_hi:
            return col, ox
    return None


def _inter_row_gap_ys(
    row_lo: int,
    row_hi: int,
    catalog: dict,
    grid: PaintGrid,
) -> set[int]:
    grid_meta = catalog.get("grid", {})
    site_h = float(grid_meta.get("siteSize", {}).get("height", 150.0))
    oy_lo = row_origin_y(row_lo, catalog)
    oy_hi = row_origin_y(row_hi, catalog)
    y_top = oy_lo + site_h
    y_bot = oy_hi
    gy_lo = grid.cell_of(0.0, y_top + 1.0)[1]
    gy_hi = grid.cell_of(0.0, y_bot - 1.0)[1]
    if gy_lo > gy_hi:
        return set()
    return set(range(gy_lo, gy_hi + 1))


def _route_inter_row_metal5(
    grid: PaintGrid,
    net_key: str,
    gx: int,
    gy_from: int,
    gy_to: int,
    catalog: dict,
    path_id: int,
    *,
    row_from: int,
    row_to: int,
) -> tuple[list[WireSegment], set[tuple[int, int]], int] | None:
    y0 = grid.center_of((gx, gy_from))[1]
    y1 = grid.center_of((gx, gy_to))[1]
    if vertical_crosses_power_bus(y0, y1, catalog):
        return None

    row_lo, row_hi = min(row_from, row_to), max(row_from, row_to)
    gap_gys = _inter_row_gap_ys(row_lo, row_hi, catalog, grid)

    step = 1 if gy_to >= gy_from else -1
    path: list[tuple[int, int]] = []
    gy = gy_from
    while True:
        path.append((gx, gy))
        if gy == gy_to:
            break
        gy += step

    del gap_gys
    for c in path:
        # 行間ギャップ内の base METAL5 は縦ジャンパのパッドのみ（passable）。
        # それ以外の障害物や他ネット配線を塗り潰すと短絡になるため不可。
        if not grid.passable(c, net_key):
            return None

    grid.paint(path, net_key)
    segs = path_to_segments(grid, path, net_key, path_id, set())
    return segs, {(gx, gy_to)}, path_id + (1 if segs else 0)


def _intra_row_jumper(
    grid: PaintGrid,
    net_key: str,
    from_cell: tuple[int, int],
    ox: float,
    oy: float,
    catalog: dict,
    path_id: int,
    *,
    to_upper: bool,
) -> tuple[list[WireSegment], set[tuple[int, int]], int] | None:
    goals = _jumper_cells(grid, ox, oy, catalog, upper=to_upper)
    goals = {c for c in goals if c[0] == from_cell[0]}
    if not goals:
        return None
    if from_cell in goals:
        return [], {from_cell}, path_id
    # ジャンパパッドは未使用なら passable。他ネット占有セルをゴールにしない
    # （以前は非 passable なゴールを obstacle_goals として許可しており短絡し得た）
    obstacle_goals: set[tuple[int, int]] = set()
    result = grid.route_and_paint(
        net_key,
        {from_cell},
        goals,
        path_id=path_id,
        obstacle_goals=obstacle_goals,
    )
    if result is None:
        return None
    segs, path = result
    if not path:
        return None
    return segs, {path[-1]}, path_id + (1 if segs else 0)


def climb_via_jumpers(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    start_site: GaSite,
    target_row: int,
    catalog: dict,
    path_id: int,
    *,
    target_col: int | None = None,
) -> tuple[list[WireSegment], set[tuple[int, int]], int] | None:
    """ジャンパ列 METAL5 + 低層ジャンパで target_row まで昇降。"""
    y_lo, y_hi = ROW_CROSSING_Y[0], ROW_CROSSING_Y[1]
    current = set(starts)
    current_row = start_site.row
    trial_segs: list[WireSegment] = []
    pid = path_id
    going_up = target_row > current_row
    prefer_col = target_col if target_col is not None else start_site.col

    leg0 = _route_to_jumper_on_row(
        grid,
        net_key,
        current,
        current_row,
        catalog,
        pid,
        upper=going_up,
        col=prefer_col,
    )
    if leg0 is None and prefer_col != start_site.col:
        leg0 = _route_to_jumper_on_row(
            grid,
            net_key,
            current,
            current_row,
            catalog,
            pid,
            upper=going_up,
            col=start_site.col,
        )
    if leg0 is None:
        leg0 = _route_to_jumper_on_row(
            grid,
            net_key,
            current,
            current_row,
            catalog,
            pid,
            upper=going_up,
        )
    if leg0 is None:
        return None
    s0, current, pid = leg0
    trial_segs.extend(s0)
    gx = next(iter(current))[0]
    site_info = _site_col_for_gx(grid, gx, current_row, catalog)
    if site_info is None:
        return None
    _col, ox = site_info

    while current_row != target_row:
        next_row = current_row + (1 if going_up else -1)
        oy_cur = row_origin_y(current_row, catalog)
        oy_nxt = row_origin_y(next_row, catalog)
        nxt_info = _site_col_for_gx(grid, gx, next_row, catalog)
        if nxt_info is None:
            return None
        _, ox_nxt = nxt_info
        jx = _local_jx_for_gx(grid, ox, gx, catalog)
        jx_nxt = _local_jx_for_gx(grid, ox_nxt, gx, catalog)
        if jx is None or jx_nxt is None:
            return None

        if going_up:
            gy_from = grid.cell_of(ox + jx, oy_cur + y_hi)[1]
            gy_to = grid.cell_of(ox_nxt + jx_nxt, oy_nxt + y_lo)[1]
        else:
            gy_from = grid.cell_of(ox + jx, oy_cur + y_lo)[1]
            gy_to = grid.cell_of(ox_nxt + jx_nxt, oy_nxt + y_hi)[1]

        from_cell = (gx, gy_from)
        if from_cell not in current:
            adj = _intra_row_jumper(
                grid,
                net_key,
                next(iter(current)),
                ox,
                oy_cur,
                catalog,
                pid,
                to_upper=going_up,
            )
            if adj is None:
                return None
            s_adj, current, pid = adj
            trial_segs.extend(s_adj)
            if next(iter(current)) != from_cell:
                return None

        leg_ir = _route_inter_row_metal5(
            grid,
            net_key,
            gx,
            gy_from,
            gy_to,
            catalog,
            pid,
            row_from=current_row,
            row_to=next_row,
        )
        if leg_ir is None:
            return None
        s_ir, landed, pid = leg_ir
        trial_segs.extend(s_ir)

        leg_j = _intra_row_jumper(
            grid,
            net_key,
            next(iter(landed)),
            ox_nxt,
            oy_nxt,
            catalog,
            pid,
            to_upper=going_up,
        )
        if leg_j is None:
            return None
        s_j, current, pid = leg_j
        trial_segs.extend(s_j)
        current_row = next_row
        ox = ox_nxt

    return trial_segs, current, pid


def _route_jumper_to_goals(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    goals: set[tuple[int, int]],
    path_id: int,
) -> tuple[list[WireSegment], list[tuple[int, int]], int] | None:
    """ジャンパ端子から目的端子へ水平（+ 行内垂直）接続。I/O 配線と同型。"""
    # ジャンパパッドは未使用なら passable。他ネット占有セルをゴールにしない
    # （以前は非 passable なゴールを obstacle_goals として許可しており短絡し得た）
    obstacle_goals: set[tuple[int, int]] = set()
    result = grid.route_and_paint(
        net_key,
        starts,
        goals,
        path_id=path_id,
        intra_cell_routing=True,
        obstacle_goals=obstacle_goals,
    )
    if result is None:
        return None
    segs, path = result
    return segs, path, path_id + (1 if segs else 0)


def connect_global_cross_row(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    goals: set[tuple[int, int]],
    src_site: GaSite,
    dst_site: GaSite,
    catalog: dict,
    path_id: int,
) -> tuple[list[WireSegment], list[tuple[int, int]], int] | None:
    """global ネット: 端子→ジャンパ水平→行昇降→ジャンパ→端子水平。"""
    if src_site.row == dst_site.row:
        return _route_jumper_to_goals(grid, net_key, starts, goals, path_id)

    climbed = climb_via_jumpers(
        grid,
        net_key,
        starts,
        src_site,
        dst_site.row,
        catalog,
        path_id,
    )
    if climbed is None:
        return None
    climb_segs, mid, pid = climbed
    routed = _route_jumper_to_goals(grid, net_key, mid, goals, pid)
    if routed is None:
        return None
    horiz_segs, path, next_pid = routed
    return climb_segs + horiz_segs, path, next_pid
