"""チップ I/O パッド (ga_in / ga_out) の座標と専用配線。

遠方 I/O への接続はジャンパ列を使った行昇降で VDD/VSS バスを回避する:

1. ゲートサイト内 METAL5 → 上行ジャンパ端子 (Y=145)
2. 繰り返し: METAL5 (上行 row N → 下行 row N±1) + 低層ジャンパ (Y=5↔145)
3. 水平 METAL5 (rowCrossing コリドー) → X=5700 手前
4. グリッド境界列でパッド Y まで垂直 → 境界以降はパッド Y の水平のみ
"""

from __future__ import annotations

from dataclasses import dataclass

from server.ga_extract import LayoutProblem
from server.ga_global_route import (
    endpoint_pad_cells,
    global_row_crossing_ys,
)
from server.ga_grid_router import PaintGrid, path_to_segments
from server.ga_jumper_climb import (
    GaSite,
    climb_via_jumpers,
    route_site_to_jumper,
    row_origin_y,
    vertical_crosses_power_bus,
)
from server.ga_placement import _cell_lookup
from server.ga_obstacles import (
    GRID_PITCH_UM,
    WIRE_CLEARANCE_UM,
    WIRE_WIDTH_UM,
    manhattan_route_avoiding,
    routing_obstacle_boxes,
    segment_blocked,
    wire_center_bbox,
)
from server.ga_router import WireSegment, orthogonal_wire_segments
from server.ga_terminals import (
    ROW_CROSSING_Y,
    global_routing_from_catalog,
    io_pads_from_catalog,
    net_kind,
)

IO_BOUNDARY_X_UM = 5700.0

GA_IN_PADS: dict[int, tuple[float, float]] = {
    0: (5797.0, 2315.0),
    1: (5797.0, 2655.0),
    2: (5797.0, 2735.0),
    3: (5797.0, 2815.0),
    4: (5797.0, 2895.0),
    5: (5797.0, 3235.0),
    6: (5797.0, 3315.0),
    7: (5797.0, 3395.0),
    8: (5797.0, 3475.0),
    9: (5797.0, 3815.0),
    10: (5797.0, 3895.0),
    11: (5797.0, 3975.0),
    12: (5797.0, 4055.0),
}

GA_OUT_PADS: dict[int, tuple[float, float]] = {
    0: (5797.0, 335.0),
    1: (5797.0, 415.0),
    2: (5797.0, 915.0),
    3: (5797.0, 995.0),
    4: (5797.0, 1075.0),
    5: (5797.0, 1155.0),
    6: (5797.0, 1495.0),
    7: (5797.0, 1575.0),
    8: (5797.0, 1655.0),
    9: (5797.0, 1735.0),
    10: (5797.0, 2075.0),
    11: (5797.0, 2155.0),
    12: (5797.0, 2235.0),
}


@dataclass(frozen=True)
class IoPadBinding:
    direction: str
    index: int
    net: str

    @property
    def net_key(self) -> str:
        return f"g:{self.net}"

    def pad_xy(
        self,
        in_pads: dict[int, tuple[float, float]] | None = None,
        out_pads: dict[int, tuple[float, float]] | None = None,
    ) -> tuple[float, float]:
        table = (
            (in_pads or GA_IN_PADS)
            if self.direction == "IN"
            else (out_pads or GA_OUT_PADS)
        )
        if self.index not in table:
            raise KeyError(f"Unknown I/O pad {self.direction}[{self.index}]")
        return table[self.index]


def parse_io_pad_bindings(netlist: str) -> list[IoPadBinding]:
    seen: set[tuple[str, int]] = set()
    bindings: list[IoPadBinding] = []
    for raw in netlist.splitlines():
        stripped = raw.strip()
        if stripped.startswith("*"):
            stripped = stripped[1:].strip()
        parts = stripped.strip().split()
        if len(parts) < 4 or parts[0].upper() != "GA_IO":
            continue
        # 指定の誤りは黙って無視せず、同期のエラーとして返す（配線されない理由が分からなくなるため）
        direction = parts[1].upper()
        if direction not in ("IN", "OUT"):
            raise RuntimeError(f"invalid GA_IO line (direction must be IN or OUT): {raw.strip()}")
        try:
            index = int(parts[2])
        except ValueError:
            raise RuntimeError(f"invalid GA_IO line (pad index must be 0-12): {raw.strip()}") from None
        pads = GA_IN_PADS if direction == "IN" else GA_OUT_PADS
        if index not in pads:
            raise RuntimeError(
                f"invalid GA_IO line (pad index must be 0-{max(pads)}): {raw.strip()}"
            )
        net = parts[3]
        key = (direction, index)
        if key in seen:
            raise RuntimeError(f"GA_IO pad {direction} {index} is assigned twice: {raw.strip()}")
        seen.add(key)
        bindings.append(IoPadBinding(direction=direction, index=index, net=net))
    return bindings


def _ga_sites(grid: PaintGrid, catalog: dict) -> list[GaSite]:
    grid_meta = catalog.get("grid", {})
    pitch_x = float(grid_meta.get("pitch", {}).get("x", 160.0))
    site_h = float(grid_meta.get("siteSize", {}).get("height", 150.0))
    sites: list[GaSite] = []
    for (row, col), cell in _cell_lookup(catalog).items():
        ox = float(cell["origin"]["x"])
        oy = float(cell["origin"]["y"])
        gx_lo = grid.cell_of(ox + 1.0, 0.0)[0]
        gx_hi = grid.cell_of(ox + pitch_x - 1.0, 0.0)[0]
        gy_lo = grid.cell_of(0.0, oy + 1.0)[1]
        gy_hi = grid.cell_of(0.0, oy + site_h - 1.0)[1]
        sites.append(
            GaSite(row, col, ox, oy, gx_lo, gx_hi, gy_lo, gy_hi)
        )
    return sites


def _io_climb_target_row(pad_y: float, catalog: dict) -> int:
    """I/O 昇降の終端 GA 行: 上行ジャンパ (Y=145) がパッド Y 以下にある最も上の行。

    ga_in[0] (Y=2315) → row 3 上行 (1985)。row 4 下行 (2425) までは不要。
    """
    ga = catalog.get("gateArray", {})
    rows = int(ga.get("rows", 9))
    best = 0
    for row in range(rows):
        upper_y = row_origin_y(row, catalog) + ROW_CROSSING_Y[1]
        if upper_y <= pad_y + 1e-6:
            best = row
    return best


def _site_bounds_for_cell(
    grid: PaintGrid,
    cell: tuple[int, int],
    sites: list[GaSite],
) -> GaSite | None:
    gx, gy = cell
    for site in sites:
        if site.gx_lo <= gx <= site.gx_hi and site.gy_lo <= gy <= site.gy_hi:
            return site
    return None


def _infer_start_site(
    grid: PaintGrid,
    starts: set[tuple[int, int]],
    problem: LayoutProblem,
    net_key: str,
    catalog: dict,
) -> GaSite | None:
    sites = _ga_sites(grid, catalog)
    for ep in problem.net_groups.get(net_key, []):
        for c in endpoint_pad_cells(grid, ep, {net_key}):
            site = _site_bounds_for_cell(grid, c, sites)
            if site is not None:
                return site
    for c in starts:
        site = _site_bounds_for_cell(grid, c, sites)
        if site is not None:
            return site
    return None


def _route_site_to_upper_jumper(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    site: GaSite,
    catalog: dict,
    path_id: int,
) -> tuple[list[WireSegment], set[tuple[int, int]], int] | None:
    return route_site_to_jumper(
        grid, net_key, starts, site, catalog, path_id, upper=True
    )


def _io_row_crossing_stub_ys(
    pad_y: float,
    catalog: dict,
    target_row: int,
) -> list[float]:
    """I/O 水平配線は rowCrossing (Y=5/145) のみ。行間ギャップは使わない。"""
    oy = row_origin_y(target_row, catalog)
    upper_y = oy + ROW_CROSSING_Y[1]
    lower_y = oy + ROW_CROSSING_Y[0]
    cands = [upper_y, lower_y]
    safe = [y for y in cands if not vertical_crosses_power_bus(y, pad_y, catalog)]
    return safe if safe else cands


def _io_extra_vertical_gys(
    grid: PaintGrid,
    catalog: dict,
) -> frozenset[int]:
    gys: set[int] = set()
    for y in global_row_crossing_ys(catalog):
        gys.add(grid.cell_of(0.0, y)[1])
    return frozenset(gys)


def _io_grid_max_gx(grid: PaintGrid, boundary_x: float) -> int:
    max_gx = int((boundary_x - grid.x0 - grid.pitch / 2.0) // grid.pitch)
    return max(0, min(max_gx, grid.nx - 1))


def _net_start_cells(
    grid: PaintGrid,
    problem: LayoutProblem,
    net_key: str,
    global_nets: set[str],
) -> set[tuple[int, int]]:
    starts = set(grid.painted_cells(net_key))
    for ep in problem.net_groups.get(net_key, []):
        starts |= endpoint_pad_cells(grid, ep, global_nets)
    return starts


def _io_climb_column_candidates(start_site: GaSite, catalog: dict) -> list[int | None]:
    """行昇降に使うジャンパ列候補（左端サイトは右側のジャンパ列を優先）。"""
    cols = int(catalog.get("gateArray", {}).get("columnsPerRow", 35))
    ordered: list[int | None] = []
    seen: set[int | None] = set()
    for col in (cols - 1, cols - 2, start_site.col, cols // 2):
        if col in seen:
            continue
        seen.add(col)
        ordered.append(col)
    if None not in seen:
        ordered.append(None)
    return ordered

def _furthest_east_on_row(
    grid: PaintGrid,
    net_key: str,
    cells: set[tuple[int, int]],
    gy: int,
    *,
    gx_hi: int | None = None,
) -> tuple[int, int] | None:
    """cells から同一 gy 行で到達可能な最東セル（gx_hi まで）。"""
    from collections import deque

    seeds = {c for c in cells if c[1] == gy}
    if not seeds:
        return None
    seen = set(seeds)
    queue: deque[tuple[int, int]] = deque(seeds)
    while queue:
        cell = queue.popleft()
        for dx in (1, -1):
            nb = (cell[0] + dx, gy)
            if nb in seen:
                continue
            if gx_hi is not None and nb[0] > gx_hi:
                continue
            if not grid.in_bounds(nb) or not grid.passable(nb, net_key):
                continue
            seen.add(nb)
            queue.append(nb)
    return max(seen, key=lambda c: c[0])


def _route_horizontal_on_row(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    goal_gx: int,
    gy: int,
    path_id: int,
) -> tuple[list[WireSegment], tuple[int, int]] | None:
    """単一行 gy 上の水平 METAL5（サイト外の行間・I/O マージンも可）。"""
    goals = {(goal_gx, gy)}
    start_gxs = {c[0] for c in starts if c[1] == gy}
    if not start_gxs:
        return None
    gx_lo = min(min(start_gxs), goal_gx)
    gx_hi = max(max(start_gxs), goal_gx)
    result = grid.route_bounded_and_paint(
        net_key,
        starts,
        goals,
        gx_lo=gx_lo,
        gx_hi=gx_hi,
        gy_lo=gy,
        gy_hi=gy,
        path_id=path_id,
        intra_cell_routing=True,
    )
    if result is None:
        return None
    segs, path = result
    if not path or path[-1] != (goal_gx, gy):
        return None
    return segs, (goal_gx, gy)


def _margin_row_gxs(
    grid: PaintGrid,
    net_key: str,
    gy: int,
    boundary_x: float,
) -> list[int]:
    return [
        gx
        for gx in range(grid.nx)
        if grid.center_of((gx, gy))[0] >= boundary_x - 1e-6
        and grid.passable((gx, gy), net_key)
    ]


def _route_row_crossing_to_east(
    grid: PaintGrid,
    net_key: str,
    starts: set[tuple[int, int]],
    stub_y: float,
    max_gx: int,
    path_id: int,
    *,
    extra_vertical_gys: frozenset[int] | None = None,
) -> tuple[list[WireSegment], tuple[float, float]] | None:
    """rowCrossing 水平コリドーをグリッド A*（同一行のみ）で東端まで延長。"""
    stub_gy = grid.cell_of(0.0, stub_y)[1]
    if not grid.in_bounds((0, stub_gy)):
        return None

    row_goals = {
        (gx, stub_gy)
        for gx in range(max_gx + 1)
        if grid.passable((gx, stub_gy), net_key)
    }
    if not row_goals:
        return None

    segments: list[WireSegment] = []
    on_row = {c for c in starts if c[1] == stub_gy}
    if not on_row:
        leg = grid.route_and_paint(
            net_key,
            starts,
            row_goals,
            path_id=path_id,
            extra_vertical_gys=extra_vertical_gys,
            intra_cell_routing=True,
        )
        if leg is None:
            return None
        segments.extend(leg[0])
        path_id += 1

    painted = grid.painted_cells(net_key)
    reachable = _furthest_east_on_row(
        grid, net_key, painted | starts, stub_gy, gx_hi=max_gx
    )
    if reachable is None:
        return None

    goal_gx = reachable[0]
    for gx in range(max_gx, reachable[0] - 1, -1):
        if grid.passable((gx, stub_gy), net_key):
            goal_gx = gx
            break

    if (goal_gx, stub_gy) not in painted or goal_gx > max(
        c[0] for c in painted if c[1] == stub_gy
    ):
        row_starts = {c for c in grid.painted_cells(net_key) if c[1] == stub_gy}
        if not row_starts:
            row_starts = on_row or starts
        horiz = _route_horizontal_on_row(
            grid, net_key, row_starts, goal_gx, stub_gy, path_id
        )
        if horiz is None:
            return None
        segments.extend(horiz[0])
        exit_cell = horiz[1]
    else:
        exit_cell = (goal_gx, stub_gy)

    if exit_cell not in grid.painted_cells(net_key):
        return None
    return segments, grid.center_of(exit_cell)


def _other_io_pad_obstacle_boxes(
    in_pads: dict[int, tuple[float, float]],
    out_pads: dict[int, tuple[float, float]],
    dest_pad: tuple[float, float],
    blocked_segments: list[WireSegment],
    net_key: str,
) -> list[tuple[float, float, float, float]]:
    """自パッド以外の I/O 端子 METAL5 + 他ネット配線をオフグリッド障害物にする。"""
    boxes = routing_obstacle_boxes([], blocked_segments, net_key)
    px, py = dest_pad
    for table in (in_pads, out_pads):
        for x, y in table.values():
            if abs(x - px) < 1e-6 and abs(y - py) < 1e-6:
                continue
            boxes.append(
                wire_center_bbox(
                    x,
                    y,
                    x,
                    y,
                    width_um=WIRE_WIDTH_UM,
                    margin_um=WIRE_CLEARANCE_UM,
                )
            )
    return boxes


def _route_horizontal_pin_leg(
    grid_exit: tuple[float, float],
    boundary_x: float,
    pad_x: float,
    pad_y: float,
    net_key: str,
    path_id: int,
    obstacle_boxes: list[tuple[float, float, float, float]],
) -> list[WireSegment] | None:
    """グリッド境界 (X>=boundary) からパッドまで水平 METAL5 のみ（5 µm・同一 path_id）。"""
    ex, ey = grid_exit
    if abs(ey - pad_y) > 1e-6:
        return None

    if ex < boundary_x - 1e-6:
        start_x = boundary_x
    else:
        start_x = ex

    if pad_x >= start_x - 1e-6:
        x0, x1 = start_x, pad_x
    else:
        x0, x1 = pad_x, start_x

    if abs(x1 - x0) < 1e-6:
        return []

    if segment_blocked(x0, pad_y, x1, pad_y, obstacle_boxes):
        detour = manhattan_route_avoiding(
            (x0, pad_y),
            (x1, pad_y),
            obstacle_boxes,
            pitch_um=GRID_PITCH_UM,
            allow_terminal=(False, True),
        )
        if detour is None:
            return None
        return orthogonal_wire_segments(detour, net_key, path_id, width_um=WIRE_WIDTH_UM)

    return orthogonal_wire_segments(
        [(x0, pad_y), (x1, pad_y)], net_key, path_id, width_um=WIRE_WIDTH_UM
    )


def _route_boundary_column_vertical(
    grid: PaintGrid,
    net_key: str,
    column_gx: int,
    from_gy: int,
    to_gy: int,
    path_id: int,
) -> tuple[list[WireSegment], tuple[int, int]] | None:
    """境界列上の単調垂直（GA 水平との T 字で折り返さない）。"""
    if from_gy == to_gy:
        return [], (column_gx, from_gy)
    step = 1 if to_gy > from_gy else -1
    cells = [(column_gx, gy) for gy in range(from_gy, to_gy + step, step)]
    for cell in cells[1:]:
        if not grid.passable(cell, net_key):
            return None
    grid.paint(cells, net_key)
    return path_to_segments(grid, cells, net_key, path_id), cells[-1]


def _bridge_stub_row_to_margin(
    grid: PaintGrid,
    net_key: str,
    exit_cell: tuple[int, int],
    margin_goals: set[tuple[int, int]],
    stub_gy: int,
    path_id: int,
    *,
    extra_vertical_gys: frozenset[int] | None = None,
) -> tuple[list[WireSegment], tuple[int, int]] | None:
    """rowCrossing 行上の水平ブリッジ（同一 gy 優先、ギャップのみ行間迂回）。"""
    gxs = [exit_cell[0]] + [g[0] for g in margin_goals]
    gx_lo, gx_hi = min(gxs), max(gxs)
    on_row = grid.route_bounded_and_paint(
        net_key,
        {exit_cell},
        margin_goals,
        gx_lo=gx_lo,
        gx_hi=gx_hi,
        gy_lo=stub_gy,
        gy_hi=stub_gy,
        path_id=path_id,
        intra_cell_routing=True,
    )
    if on_row is not None:
        segs, path = on_row
        return segs, path[-1]

    margin_entry_gx = min(g[0] for g in margin_goals)
    upper_gy = stub_gy + 1
    if not grid.in_bounds((margin_entry_gx, upper_gy)):
        return None
    # 行間迂回は gy+1 行で境界列に入る（stub 行への drop を避け GA 水平 T 字の下向きはみ出しを防ぐ）
    detour = grid.route_and_paint(
        net_key,
        {exit_cell},
        {(margin_entry_gx, upper_gy)},
        path_id=path_id,
        extra_vertical_gys=extra_vertical_gys,
        intra_cell_routing=True,
    )
    if detour is None:
        return None
    segs, path = detour
    return segs, path[-1]


def _route_io_margin_legs(
    grid: PaintGrid,
    net_key: str,
    stub_y: float,
    stub_gy: int,
    boundary_x: float,
    pad_y: float,
    max_gx: int,
    path_id: int,
    *,
    extra_vertical_gys: frozenset[int] | None = None,
) -> tuple[list[WireSegment], tuple[float, float]] | None:
    """I/O マージン: rowCrossing 水平 → 境界列でパッド Y まで垂直（水平は境界以降）。"""
    segments: list[WireSegment] = []
    painted = grid.painted_cells(net_key)
    row_cells = [c for c in painted if c[1] == stub_gy]
    if not row_cells:
        return None
    exit_cell = max(row_cells, key=lambda c: c[0])
    exit_x = grid.center_of(exit_cell)[0]

    margin_gxs = _margin_row_gxs(grid, net_key, stub_gy, boundary_x)
    if not margin_gxs:
        return None

    margin_entry_gx = min(margin_gxs)
    margin_entry_x = grid.center_of((margin_entry_gx, stub_gy))[0]
    junction = (margin_entry_gx, stub_gy)

    pad_gy = grid.cell_of(0.0, pad_y)[1]
    if not grid.passable((margin_entry_gx, pad_gy), net_key):
        return None

    if exit_x < margin_entry_x - 1e-6:
        bridge = _bridge_stub_row_to_margin(
            grid,
            net_key,
            exit_cell,
            {junction},
            stub_gy,
            path_id,
            extra_vertical_gys=extra_vertical_gys,
        )
        if bridge is None:
            return None
        bridge_segs, end_cell = bridge
        segments.extend(bridge_segs)
        vert_pid = path_id
        path_id += max(1, len(bridge_segs))
    else:
        end_cell = exit_cell
        vert_pid = path_id
        if end_cell[0] != margin_entry_gx:
            horiz = _route_horizontal_on_row(
                grid,
                net_key,
                {end_cell},
                margin_entry_gx,
                stub_gy,
                path_id,
            )
            if horiz is None:
                return None
            h_segs, end_cell = horiz
            segments.extend(h_segs)
            path_id += max(1, len(h_segs))

    if end_cell[1] != pad_gy:
        vert = _route_boundary_column_vertical(
            grid, net_key, margin_entry_gx, end_cell[1], pad_gy, vert_pid
        )
        if vert is None:
            return None
        v_segs, _end = vert
        segments.extend(v_segs)

    column_x = grid.center_of((margin_entry_gx, pad_gy))[0]
    return segments, (column_x, pad_y)


def _route_io_climb(
    grid: PaintGrid,
    problem: LayoutProblem,
    binding: IoPadBinding,
    *,
    catalog: dict,
    global_nets: set[str],
    path_id: int,
) -> tuple[list[WireSegment], int] | None:
    """行昇降のみ（境界水平は別フェーズ）。"""
    _pad_x, pad_y = binding.pad_xy()
    starts = _net_start_cells(grid, problem, binding.net_key, global_nets)
    if not starts:
        return None

    target_row = _io_climb_target_row(pad_y, catalog)
    start_site = _infer_start_site(
        grid, starts, problem, binding.net_key, catalog
    )
    segments: list[WireSegment] = []

    if start_site is not None and start_site.row != target_row:
        climbed = None
        for col in _io_climb_column_candidates(start_site, catalog):
            climbed = climb_via_jumpers(
                grid,
                binding.net_key,
                starts,
                start_site,
                target_row,
                catalog,
                path_id,
                target_col=col,
            )
            if climbed is not None:
                break
        if climbed is None:
            return None
        climb_segs, _climb_mid, path_id = climbed
        segments.extend(climb_segs)
    elif start_site is not None:
        leg0 = _route_site_to_upper_jumper(
            grid,
            binding.net_key,
            starts,
            start_site,
            catalog,
            path_id,
        )
        if leg0 is not None:
            s0, _mid, path_id = leg0
            segments.extend(s0)

    return segments, path_id


def _route_io_pad_boundary(
    grid: PaintGrid,
    problem: LayoutProblem,
    binding: IoPadBinding,
    *,
    catalog: dict,
    global_nets: set[str],
    boundary_x: float,
    max_gx: int,
    in_pads: dict[int, tuple[float, float]],
    out_pads: dict[int, tuple[float, float]],
    path_id: int,
    base_obstacle_boxes: list[tuple[float, float, float, float]],
    blocked_segments: list[WireSegment],
) -> tuple[list[WireSegment], int] | None:
    """rowCrossing グリッド → 境界列垂直 → パッド Y 水平。"""
    pad_x, pad_y = binding.pad_xy(in_pads, out_pads)
    target_row = _io_climb_target_row(pad_y, catalog)
    starts = _net_start_cells(grid, problem, binding.net_key, global_nets)
    if not starts:
        return None

    obstacle_boxes = _other_io_pad_obstacle_boxes(
        in_pads,
        out_pads,
        (pad_x, pad_y),
        blocked_segments,
        binding.net_key,
    )
    extra_vertical_gys = _io_extra_vertical_gys(grid, catalog)

    for stub_y in _io_row_crossing_stub_ys(pad_y, catalog, target_row):
        segments: list[WireSegment] = []
        pid = path_id

        grid_result = _route_row_crossing_to_east(
            grid,
            binding.net_key,
            starts,
            stub_y,
            max_gx,
            pid,
            extra_vertical_gys=extra_vertical_gys,
        )
        if grid_result is None:
            continue
        grid_segs, grid_exit = grid_result
        actual_stub_y = grid_exit[1]
        if vertical_crosses_power_bus(actual_stub_y, pad_y, catalog):
            continue
        segments.extend(grid_segs)
        pid += max(1, len(grid_segs))

        stub_gy = grid.cell_of(0.0, actual_stub_y)[1]
        margin_result = _route_io_margin_legs(
            grid,
            binding.net_key,
            actual_stub_y,
            stub_gy,
            boundary_x,
            pad_y,
            max_gx,
            pid,
            extra_vertical_gys=extra_vertical_gys,
        )
        if margin_result is None:
            continue
        margin_segs, margin_exit = margin_result
        segments.extend(margin_segs)
        pid += max(1, len(margin_segs))

        margin_path_id = margin_segs[-1].path_id if margin_segs else pid
        pin_leg = _route_horizontal_pin_leg(
            margin_exit,
            boundary_x,
            pad_x,
            pad_y,
            binding.net_key,
            path_id=margin_path_id,
            obstacle_boxes=obstacle_boxes,
        )
        if pin_leg is None:
            continue
        segments.extend(pin_leg)

        grid.rasterize_segments(segments)
        return segments, pid + 1

    return None


def _route_one_io_pad(
    grid: PaintGrid,
    problem: LayoutProblem,
    binding: IoPadBinding,
    *,
    catalog: dict,
    global_nets: set[str],
    boundary_x: float,
    max_gx: int,
    in_pads: dict[int, tuple[float, float]],
    out_pads: dict[int, tuple[float, float]],
    path_id: int,
    base_obstacle_boxes: list[tuple[float, float, float, float]],
    blocked_segments: list[WireSegment],
) -> tuple[list[WireSegment], list[WireSegment], int] | None:
    """1 パッド分の I/O 配線。(全セグメント, 境界以降セグメント, 次 path_id)。

    1. 従来方式: ジャンパ列で行昇降 → rowCrossing 水平 → 境界列 → パッド
    2. フォールバック: ジャンパ（サイト内・行間ギャップ）を使う汎用 A* で
       境界マージンのパッド Y 行まで到達 → パッドへ水平
    いずれも失敗時は塗りつぶしを巻き戻す（途中まで塗られたセルが
    以降の配線の始点に使われてオープンになるのを防ぐ）。
    """
    mark = grid.checkpoint()
    climbed = _route_io_climb(
        grid,
        problem,
        binding,
        catalog=catalog,
        global_nets=global_nets,
        path_id=path_id,
    )
    if climbed is not None:
        climb_segs, pid = climbed
        routed = _route_io_pad_boundary(
            grid,
            problem,
            binding,
            catalog=catalog,
            global_nets=global_nets,
            boundary_x=boundary_x,
            max_gx=max_gx,
            in_pads=in_pads,
            out_pads=out_pads,
            path_id=pid,
            base_obstacle_boxes=base_obstacle_boxes,
            blocked_segments=blocked_segments,
        )
        if routed is not None:
            boundary_segs, pid = routed
            return climb_segs + boundary_segs, boundary_segs, pid
    grid.rollback(mark)

    generic = _route_io_pad_generic(
        grid,
        problem,
        binding,
        global_nets=global_nets,
        boundary_x=boundary_x,
        in_pads=in_pads,
        out_pads=out_pads,
        path_id=path_id,
        blocked_segments=blocked_segments,
    )
    if generic is None:
        grid.rollback(mark)
        return None
    segs, pin_leg, pid = generic
    return segs, pin_leg, pid


def _route_io_pad_generic(
    grid: PaintGrid,
    problem: LayoutProblem,
    binding: IoPadBinding,
    *,
    global_nets: set[str],
    boundary_x: float,
    in_pads: dict[int, tuple[float, float]],
    out_pads: dict[int, tuple[float, float]],
    path_id: int,
    blocked_segments: list[WireSegment],
) -> tuple[list[WireSegment], list[WireSegment], int] | None:
    """汎用 A*（ジャンパ利用）でネットからパッド手前のマージンセルまで配線する。"""
    pad_x, pad_y = binding.pad_xy(in_pads, out_pads)
    starts = _net_start_cells(grid, problem, binding.net_key, global_nets)
    if not starts:
        return None
    pad_gy = grid.cell_of(0.0, pad_y)[1]
    if abs(grid.center_of((0, pad_gy))[1] - pad_y) > 1e-6:
        return None
    pad_gx = grid.cell_of(pad_x, pad_y)[0]
    # パッド直前のセル（パッド自身は base.gds の METAL5 で障害物セル）
    goal_gx = pad_gx - 1
    if grid.center_of((goal_gx, pad_gy))[0] < boundary_x - 1e-6:
        return None
    goal = (goal_gx, pad_gy)
    if not grid.passable(goal, binding.net_key):
        return None
    routed = grid.route_and_paint(
        binding.net_key,
        starts,
        {goal},
        path_id=path_id,
        intra_cell_routing=True,
    )
    if routed is None:
        return None
    segs, path = routed
    if not path or path[-1] != goal:
        return None
    exit_xy = grid.center_of(goal)
    obstacle_boxes = _other_io_pad_obstacle_boxes(
        in_pads, out_pads, (pad_x, pad_y), blocked_segments, binding.net_key
    )
    pin_path_id = segs[-1].path_id if segs else path_id
    pin_leg = _route_horizontal_pin_leg(
        exit_xy,
        boundary_x,
        pad_x,
        pad_y,
        binding.net_key,
        path_id=pin_path_id,
        obstacle_boxes=obstacle_boxes,
    )
    if pin_leg is None:
        return None
    grid.rasterize_segments(pin_leg)
    return segs + pin_leg, segs + pin_leg, path_id + 1


def route_io_pads(
    grid: PaintGrid,
    problem: LayoutProblem,
    bindings: list[IoPadBinding],
    *,
    catalog: dict | None = None,
    global_nets: set[str] | None = None,
    path_id_start: int = 1,
    base_obstacle_boxes: list[tuple[float, float, float, float]] | None = None,
) -> list[WireSegment] | None:
    if not bindings:
        return []

    catalog = catalog or {}
    gr = global_routing_from_catalog(catalog)
    boundary_x = float(gr.get("ioBoundaryXUm", IO_BOUNDARY_X_UM))
    in_pads, out_pads = io_pads_from_catalog(catalog)
    global_nets = global_nets or {b.net_key for b in bindings}
    max_gx = _io_grid_max_gx(grid, boundary_x)
    base_obstacle_boxes = base_obstacle_boxes or []

    signal_bindings = [
        b
        for b in bindings
        if net_kind(b.net_key) == "signal" and b.net_key in problem.net_groups
    ]
    if not signal_bindings:
        return []

    segments: list[WireSegment] = []
    blocked_segments: list[WireSegment] = []
    path_id = path_id_start

    # OUT → IN の順で行昇降 + rowCrossing 水平 + オフグリッド
    boundary_order = sorted(
        signal_bindings,
        key=lambda b: (0 if b.direction == "OUT" else 1, b.index),
    )
    for binding in boundary_order:
        routed = _route_one_io_pad(
            grid,
            problem,
            binding,
            catalog=catalog,
            global_nets=global_nets,
            boundary_x=boundary_x,
            max_gx=max_gx,
            in_pads=in_pads,
            out_pads=out_pads,
            path_id=path_id,
            base_obstacle_boxes=base_obstacle_boxes,
            blocked_segments=blocked_segments,
        )
        if routed is None:
            return None
        pad_segs, boundary_segs, path_id = routed
        segments.extend(pad_segs)
        blocked_segments.extend(boundary_segs)

    return segments
