"""ネットリスト → ゲート配置 → METAL5 配線 → オーバーレイ GDS。

信号配線は 10 µm セル塗りつぶし式ルーター（ga_grid_router.PaintGrid）で行う。
- base.gds の METAL5 と電源配線をセル障害物として焼き込み、
  各ネットは A* でセルを塗りつぶしながら順に配線する（交差は構造的に不可能）。
- 同一行内ネットは routingTracks (25/65/85/125)、行跨ぎ・I/O ネットは
  rowCrossingY (5/145) 端子から引き出し、行内水平は routingTracks も使用可。
  行跨ぎ global 信号は I/O と同型のジャンパ列 METAL5 昇降で接続する。
- 配線結果はデバッグ用ビットマップ (PNG) として GDS と並べて保存する。
"""

from __future__ import annotations

import random
from pathlib import Path

from server.fab import get_base_gds_path, load_gate_array_catalog
from server.ga_channel_router import (
    _collect_routed_pins,
    _route_vdd_net,
    _route_vss_net,
)
from server.ga_extract import (
    LayoutProblem,
    NetEndpoint,
    _endpoint_id,
    build_layout_problem,
)
from server.ga_grid_router import PaintGrid
from server.ga_io_pads import parse_io_pad_bindings, route_io_pads
from server.ga_netlist import parse_ga_instances
from server.ga_obstacles import load_jumper_pairs, load_m5_obstacle_boxes
from server.ga_overlay import generate_overlay_gds
from server.ga_jumper_climb import connect_global_cross_row, ga_site_for_gate
from server.ga_placement import PlacedGate, place_gates_once
from server.ga_router import WireSegment
from server.ga_verify import verify_routing
from server.ga_global_route import (
    classify_global_nets,
    endpoint_escape_pad_cells,
    endpoint_pad_cells,
    endpoint_registered_tracks,
    register_global_routing_infrastructure,
)
from server.ga_terminals import (
    ROUTING_TRACKS,
    assign_endpoint_coordinates,
    net_kind,
    signal_track_y,
)


def _is_power_net(net_key: str) -> bool:
    return net_key in ("g:VDD", "g:VSS", "g:0")


def _pick_representative_ep(
    endpoints: list[NetEndpoint],
    net_key: str,
) -> NetEndpoint:
    if net_key.startswith("g:"):
        preference = ("G1", "G2", "N2", "P2", "N1", "P3")
    else:
        preference = ("G1", "G2", "N2", "P2", "N1", "N3", "P1", "P3")
    for name in preference:
        for ep in endpoints:
            if ep.gate_pin == name:
                return ep
    return endpoints[0]


def _endpoints_by_gate(
    endpoints: list[NetEndpoint],
) -> dict[tuple[str, str], list[NetEndpoint]]:
    by_gate: dict[tuple[str, str], list[NetEndpoint]] = {}
    for ep in endpoints:
        gate_key = (ep.component_ref, ep.gate_instance)
        by_gate.setdefault(gate_key, []).append(ep)
    return by_gate


def _net_sort_key(item: tuple[str, list[NetEndpoint]]) -> tuple[int, int, str]:
    net_key, endpoints = item
    if _is_power_net(net_key):
        return (2, len(endpoints), net_key)
    if net_key.startswith("l:"):
        return (0, len(endpoints), net_key)
    return (1, len(endpoints), net_key)


def _gate_driver_rank(endpoints: list[NetEndpoint]) -> int:
    """0 = 出力端子 (N2/P2) を持つゲート（ドライバ側）。"""
    if any(ep.gate_pin in ("N2", "P2") for ep in endpoints):
        return 0
    return 1


def _register_signal_pads(
    problem: LayoutProblem,
    grid: PaintGrid,
    global_nets: set[str],
) -> None:
    """信号端子パッドを PaintGrid に登録する。

    同一行内ネットは routingTracks (25/65/85/125)、行跨ぎ・I/O ネットは
    rowCrossingY (5/145) を主に使う。グローバルネットも metal5Ties 用に
    pin 固有トラック (25/65/85/125) を併せて登録する。
    """
    for net_key, endpoints in problem.net_groups.items():
        if net_kind(net_key) != "signal":
            continue
        for ep in endpoints:
            for track in endpoint_registered_tracks(ep, global_nets):
                grid.register_pad(ep.x, ep.origin_y + track, net_key)


def _route_power_nets(
    problem: LayoutProblem,
    placed,
    catalog: dict,
    grid: PaintGrid,
) -> list[WireSegment]:
    """VDD/VSS: チャネル規則（垂直タイ + バス横配線）。配線後グリッドに焼き込む。"""
    by_pins = _collect_routed_pins(problem, placed, catalog)
    segments: list[WireSegment] = []

    for net_key, pins in sorted(by_pins.items(), key=lambda x: x[0]):
        if len(pins) < 2:
            continue
        kind = net_kind(net_key)
        if kind == "vdd":
            psegs = _route_vdd_net(pins, net_key)
        elif kind == "vss":
            psegs = _route_vss_net(pins, net_key)
        else:
            continue
        segments.extend(psegs)
        grid.rasterize_segments(psegs)

    return segments


def _endpoint_lookup(problem: LayoutProblem) -> dict[str, NetEndpoint]:
    out: dict[str, NetEndpoint] = {}
    for eps in problem.net_groups.values():
        for ep in eps:
            eid = _endpoint_id(ep.component_ref, ep.gate_instance, ep.gate_pin)
            out[eid] = ep
    return out


def _intra_gate_tie_pad_cells(
    grid: PaintGrid,
    ep: NetEndpoint,
) -> set[tuple[int, int]]:
    """ゲート内 metal5Tie 用: 各 routingTrack 上の端子パッドセル。"""
    return {
        grid.cell_of(ep.x, ep.origin_y + track)
        for track in ROUTING_TRACKS
    }


def _route_global_intra_gate_tie(
    grid: PaintGrid,
    net_key: str,
    ea: NetEndpoint,
    eb: NetEndpoint,
    island_cells: dict[str, set[tuple[int, int]]],
    find,
    ep_key,
    *,
    path_id: int,
) -> tuple[list[WireSegment], list[tuple[int, int]]] | None:
    """グローバルネットのゲート内 metal5Tie をセル内 A* で配線する。

    行跨ぎ/I/O 向け rowCrossing 制約は維持しつつ、同一セル内タイだけ
    非グローバル信号と同様に routingTracks 上で A* 迂回できる。
    """
    if ea.origin_y != eb.origin_y:
        return None
    ra, rb = find(ep_key(ea)), find(ep_key(eb))
    # Phase 1 で論理統合済み (ra==rb) でも Y=85 等の routingTracks タイは未配線。
    # 島セル (rowCrossingY のみ) を starts/goals に含めると集合が一致し A* が空返却する。
    starts = _intra_gate_tie_pad_cells(grid, ea)
    goals = _intra_gate_tie_pad_cells(grid, eb)
    if ra != rb:
        starts |= island_cells[ra]
        goals |= island_cells[rb]
    return grid.route_and_paint(
        net_key,
        starts,
        goals,
        path_id=path_id,
        intra_cell_routing=True,
        bounds=grid.row_band_bounds(
            ea.origin_y + 75.0, min(ea.x, eb.x), max(ea.x, eb.x)
        ),
    )


def _try_route(grid: PaintGrid, fn):
    """配線試行をトランザクションとして実行する。失敗時は塗りつぶしを巻き戻す。

    失敗した試行の途中セグメントが「塗り済み（=そのネットの導体）」として
    グリッドに残ると、後続の配線がそこを始点にして実配線と繋がらない
    （オープン）結果になるため、必ずロールバックする。
    """
    mark = grid.checkpoint()
    try:
        result = fn()
    except Exception:
        grid.rollback(mark)
        raise
    if result is None:
        grid.rollback(mark)
    return result


def _route_signal_nets(
    problem: LayoutProblem,
    grid: PaintGrid,
    global_nets: set[str],
    *,
    catalog: dict,
    placed: list[PlacedGate],
    rng: random.Random | None = None,
    stats: dict | None = None,
) -> list[WireSegment] | None:
    """信号ネットをセル塗りつぶし A* で順に配線する。

    各接続は確定と同時にセルを占有するため、後続の配線が交差することはない。
    rng を渡すと Phase 2/3 の配線順を並べ替える（順序依存の混雑を
    リトライで回避するため）。

    行跨ぎ（global）接続は、ジャンパ列を使う構造的な昇降を試したあと、
    base.gds の全ジャンパ（サイト内 Y=5↔145、行間ギャップの縦ジャンパ）を
    テレポート辺として使う汎用 A* へフォールバックする。
    """
    all_segments: list[WireSegment] = []
    path_id = 1
    placed_map = {
        (pg.slot.component_ref, pg.slot.gate_instance): pg for pg in placed
    }
    id_to_ep = _endpoint_lookup(problem)
    instance_order = {
        inst.ref: idx for idx, inst in enumerate(problem.instances)
    }
    if stats is None:
        stats = {}
    stats.setdefault("failed", None)

    signal_items = [
        (net_key, endpoints)
        for net_key, endpoints in sorted(
            problem.net_groups.items(),
            key=_net_sort_key,
        )
        if not _is_power_net(net_key)
    ]

    def same_gate(ea: NetEndpoint, eb: NetEndpoint) -> bool:
        return (ea.component_ref, ea.gate_instance) == (
            eb.component_ref,
            eb.gate_instance,
        )

    # ネットごとの連結成分（島）管理。塗り済みセルが別の島のパッドを含んでいても
    # 「接続済み」と誤判定しないよう、島単位でセル集合を持つ。
    def ep_key(ep: NetEndpoint) -> str:
        return _endpoint_id(ep.component_ref, ep.gate_instance, ep.gate_pin)

    parent: dict[str, str] = {}
    island_cells: dict[str, set[tuple[int, int]]] = {}
    island_eps: dict[str, list[NetEndpoint]] = {}

    def find(eid: str) -> str:
        while parent[eid] != eid:
            parent[eid] = parent[parent[eid]]
            eid = parent[eid]
        return eid

    for net_key, endpoints in signal_items:
        for ep in endpoints:
            eid = ep_key(ep)
            parent[eid] = eid
            island_cells[eid] = set(endpoint_pad_cells(grid, ep, global_nets))
            island_eps[eid] = [ep]

    def union(ra: str, rb: str, extra: set[tuple[int, int]] | list) -> None:
        """rb を ra に統合し、経路セル（+ ジャンパ反対端）を島に加える。"""
        island_cells[ra] |= island_cells.pop(rb) | grid.with_jumper_partners(extra)
        island_eps[ra].extend(island_eps.pop(rb))
        parent[rb] = ra

    def merge_islands(ea: NetEndpoint, eb: NetEndpoint) -> None:
        ra, rb = find(ep_key(ea)), find(ep_key(eb))
        if ra == rb:
            return
        union(ra, rb, set())
        grid.paint(island_cells[ra], ea.net_key)

    def escape_cells(root: str) -> set[tuple[int, int]]:
        """島内ピンの rowCrossing (Y=5/145) パッド（行間ギャップへの出口）。"""
        out: set[tuple[int, int]] = set()
        for ep in island_eps[root]:
            out |= endpoint_escape_pad_cells(grid, ep)
        return out

    def generic_route(
        net_key: str,
        starts: set[tuple[int, int]],
        goals: set[tuple[int, int]],
    ) -> tuple[list[WireSegment], list[tuple[int, int]]] | None:
        """ジャンパをテレポート辺として使う制約なし A*（行内・行間とも可）。"""
        return grid.route_and_paint(
            net_key,
            starts,
            goals,
            path_id=path_id,
            intra_cell_routing=True,
        )

    def commit(
        ra: str,
        rb: str,
        segs: list[WireSegment],
        path,
        *,
        next_pid: int | None = None,
    ) -> None:
        nonlocal path_id
        union(ra, rb, set(path))
        if segs:
            path_id = next_pid if next_pid is not None else path_id + 1
            all_segments.extend(segs)

    def route_global(net_key: str, ea: NetEndpoint, eb: NetEndpoint) -> bool:
        ra, rb = find(ep_key(ea)), find(ep_key(eb))
        pg_a = placed_map.get((ea.component_ref, ea.gate_instance))
        pg_b = placed_map.get((eb.component_ref, eb.gate_instance))
        src_site = ga_site_for_gate(grid, pg_a, catalog) if pg_a else None
        dst_site = ga_site_for_gate(grid, pg_b, catalog) if pg_b else None

        # 1) 汎用 A*: 行間ギャップの縦ジャンパ (JUMPLINE1) で既存の水平配線を
        #    跨ぎ、サイト内ジャンパ (JUMPLINE2) で行を跨ぐ。縦移動をジャンパに
        #    任せるため、ギャップを縦断する METAL5 の「壁」を作らず、後続の
        #    水平配線の通り道を残せる。
        routed = _try_route(
            grid,
            lambda: generic_route(net_key, island_cells[ra], island_cells[rb]),
        )
        if routed is not None:
            commit(ra, rb, *routed)
            stats["generic"] = stats.get("generic", 0) + 1
            return True

        # 2) フォールバック: ジャンパ列による構造的な昇降（従来方式）。双方向に試す。
        if src_site is not None and dst_site is not None:
            for (r_from, r_to, s_from, s_to) in (
                (ra, rb, src_site, dst_site),
                (rb, ra, dst_site, src_site),
            ):
                crossed = _try_route(
                    grid,
                    lambda r_from=r_from, r_to=r_to, s_from=s_from, s_to=s_to: (
                        connect_global_cross_row(
                            grid,
                            net_key,
                            island_cells[r_from],
                            island_cells[r_to],
                            s_from,
                            s_to,
                            catalog,
                            path_id,
                        )
                    ),
                )
                if crossed is not None:
                    segs, path, next_pid = crossed
                    commit(r_from, r_to, segs, path, next_pid=next_pid)
                    stats["structured"] = stats.get("structured", 0) + 1
                    return True
        return False

    def route_connection(net_key: str, ea: NetEndpoint, eb: NetEndpoint) -> bool:
        """ea の島（パッド + 塗り済みセル）から eb の島へ接続する。"""
        ra, rb = find(ep_key(ea)), find(ep_key(eb))
        if ra == rb:
            return True

        if net_key in global_nets:
            ok = route_global(net_key, ea, eb)
        else:
            # 1) 行内 routingTracks 上の A*（従来方式）
            band = grid.row_band_bounds(ea.origin_y + 75.0, 0.0, 0.0)
            if band is not None:
                band = (0, band[1], grid.nx - 1, band[3])
            routed = _try_route(
                grid,
                lambda: grid.route_and_paint(
                    net_key,
                    island_cells[ra],
                    island_cells[rb],
                    path_id=path_id,
                    bounds=band if ea.origin_y == eb.origin_y else None,
                ),
            )
            if routed is not None:
                commit(ra, rb, *routed)
                return True
            # 2) 行内が混雑して塞がった場合: ピン列の Y=5/145 パッドから
            #    行間ギャップへ逃がして迂回する。
            routed = _try_route(
                grid,
                lambda: generic_route(
                    net_key,
                    island_cells[ra] | escape_cells(ra),
                    island_cells[rb] | escape_cells(rb),
                ),
            )
            ok = routed is not None
            if ok:
                commit(ra, rb, *routed)
                stats["escape"] = stats.get("escape", 0) + 1
        if not ok:
            stats["failed"] = (net_key, ep_key(ea), ep_key(eb))
        return ok

    # Phase 1: ゲート内 metal5Ties
    for net_key, _ in signal_items:
        for a_id, b_id in problem.required_pairs:
            ea = id_to_ep.get(a_id)
            eb = id_to_ep.get(b_id)
            if ea is None or eb is None or ea.net_key != net_key:
                continue
            if not same_gate(ea, eb):
                continue
            if net_key in global_nets:
                # rowCrossing 端子を島に統合（Y=5↔145 間の METAL5 タイは後段）
                merge_islands(ea, eb)
            elif not route_connection(net_key, ea, eb):
                return None

    # Phase 2: interGate 必須ペア
    cross_pairs: list[tuple[NetEndpoint, NetEndpoint]] = []
    seen_cross: set[tuple[str, str]] = set()
    for a_id, b_id in problem.required_pairs:
        ea = id_to_ep.get(a_id)
        eb = id_to_ep.get(b_id)
        if ea is None or eb is None:
            continue
        if same_gate(ea, eb):
            continue
        key = tuple(sorted((a_id, b_id)))
        if key in seen_cross:
            continue
        seen_cross.add(key)
        cross_pairs.append((ea, eb))
    if rng is not None:
        rng.shuffle(cross_pairs)
    for ea, eb in cross_pairs:
        if not route_connection(ea.net_key, ea, eb):
            return None

    # Phase 3: ネットの全ピンをドライバへスター接続する。
    # ゲート内タイ（Phase 1）で接続済みのピンは union-find で同一の島に
    # なっているため no-op になる。NAND2 の A=B のように同一ゲート内でも
    # タイの無い複数ピンが同じネットに載るケースを漏らさない。
    # 行内ネット（混雑しにくい短距離）→ 行跨ぎネットの順に配線し、
    # 行跨ぎ配線が行内の配線資源を先取りしないようにする。
    local_pairs: list[tuple[str, NetEndpoint, NetEndpoint]] = []
    global_pairs: list[tuple[str, NetEndpoint, NetEndpoint]] = []
    for net_key, endpoints in signal_items:
        if len(endpoints) < 2:
            continue
        by_gate = _endpoints_by_gate(endpoints)
        ordered_gates = sorted(
            by_gate.items(),
            key=lambda item: (
                _gate_driver_rank(item[1]),
                instance_order.get(item[0][0], 999),
            ),
        )
        driver = _pick_representative_ep(ordered_gates[0][1], net_key)
        bucket = global_pairs if net_key in global_nets else local_pairs
        for _, gate_eps in ordered_gates:
            for ep in gate_eps:
                if ep is driver:
                    continue
                bucket.append((net_key, driver, ep))
    if rng is not None:
        rng.shuffle(local_pairs)
        rng.shuffle(global_pairs)
    for net_key, driver, ep in local_pairs + global_pairs:
        if not route_connection(net_key, driver, ep):
            return None

    # Phase 4: グローバルネットのゲート内タイ (N2↔P2 等) を routingTracks 上で A* 配線。
    # 他ネットの行内/行跨ぎ配線完了後に行い、配線阻害を避ける。
    global_tie_pairs: list[tuple[str, NetEndpoint, NetEndpoint]] = []
    for net_key, _ in signal_items:
        if net_key not in global_nets:
            continue
        for a_id, b_id in problem.required_pairs:
            ea = id_to_ep.get(a_id)
            eb = id_to_ep.get(b_id)
            if ea is None or eb is None or ea.net_key != net_key:
                continue
            if same_gate(ea, eb):
                global_tie_pairs.append((net_key, ea, eb))
    if rng is not None:
        rng.shuffle(global_tie_pairs)
    for net_key, ea, eb in global_tie_pairs:
        tie = _try_route(
            grid,
            lambda net_key=net_key, ea=ea, eb=eb: _route_global_intra_gate_tie(
                grid,
                net_key,
                ea,
                eb,
                island_cells,
                find,
                ep_key,
                path_id=path_id,
            ),
        )
        if tie is None:
            # 行内トラックが塞がっている: ピン列の全パッド（Y=5/145 含む）同士を
            # 汎用 A* で接続（行間ギャップ経由の迂回を許可）。
            tie = _try_route(
                grid,
                lambda net_key=net_key, ea=ea, eb=eb: generic_route(
                    net_key,
                    _intra_gate_tie_pad_cells(grid, ea)
                    | endpoint_escape_pad_cells(grid, ea),
                    _intra_gate_tie_pad_cells(grid, eb)
                    | endpoint_escape_pad_cells(grid, eb),
                ),
            )
        if tie is None:
            stats["failed"] = (net_key, ep_key(ea), ep_key(eb))
            return None
        tie_segs, tie_path = tie
        if tie_segs:
            path_id += 1
            all_segments.extend(tie_segs)
        ra = find(ep_key(ea))
        island_cells[ra] |= grid.with_jumper_partners(tie_path)
        grid.paint(island_cells[ra], net_key)
        merge_islands(ea, eb)

    return all_segments


def sync_ga_layout(
    netlist: str,
    overlay_path: Path,
    *,
    max_attempts: int = 72,
) -> dict:
    instances = parse_ga_instances(netlist)
    io_bindings = parse_io_pad_bindings(netlist)
    if not instances:
        generate_overlay_gds([], overlay_path)
        return {
            "ga_instances": 0,
            "gates_placed": 0,
            "wire_segments": 0,
            "placement_rows": {},
        }

    catalog = load_gate_array_catalog()
    problem = build_layout_problem(instances)
    base_gds = get_base_gds_path()
    bbox = tuple(catalog["baseGds"]["bbox"])
    obstacles = load_m5_obstacle_boxes(base_gds)
    jumper_pairs = load_jumper_pairs(base_gds)

    rows = int(catalog.get("gateArray", {}).get("rows", 9))
    last_error = "placement failed"
    for seed in range(max_attempts):
        plan = place_gates_once(
            problem,
            catalog,
            seed=seed,
            allow_split=seed >= rows,
        )
        if plan is None:
            last_error = "no gate-array sites available"
            continue

        assign_endpoint_coordinates(problem, plan.placed, catalog)

        global_nets = classify_global_nets(problem, io_bindings)

        grid = PaintGrid(bbox, obstacles)
        grid.set_global_nets(global_nets)
        _register_signal_pads(problem, grid, global_nets)
        register_global_routing_infrastructure(grid, plan.placed, catalog)

        segments = _route_power_nets(problem, plan.placed, catalog, grid)
        rng = random.Random(seed) if seed > 0 else None
        route_stats: dict = {}
        signal_segments = _route_signal_nets(
            problem,
            grid,
            global_nets,
            catalog=catalog,
            placed=plan.placed,
            rng=rng,
            stats=route_stats,
        )
        if signal_segments is None:
            failed = route_stats.get("failed")
            last_error = "maze routing failed" + (
                f" ({failed[0]}: {failed[1]} -> {failed[2]})" if failed else ""
            )
            continue
        segments.extend(signal_segments)

        io_segments = route_io_pads(
            grid,
            problem,
            io_bindings,
            catalog=catalog,
            global_nets=global_nets,
            path_id_start=len(segments) + 1,
            base_obstacle_boxes=obstacles,
        )
        if io_segments is None and io_bindings:
            last_error = "I/O pad routing failed"
            continue
        if io_segments:
            segments.extend(io_segments)

        # 出力セグメントだけから導通を再構成して短絡・開放・間隔を検証する。
        # 不合格の配置・配線は採用せず、次の seed で再試行する。
        report = verify_routing(
            segments,
            problem,
            plan.placed,
            catalog,
            obstacles,
            jumper_pairs,
            io_bindings=io_bindings,
        )
        if not report.ok:
            last_error = "verification failed: " + "; ".join(report.errors()[:3])
            continue

        bitmap_path = overlay_path.with_name(overlay_path.stem + "_grid.png")
        grid.save_bitmap(bitmap_path)

        generate_overlay_gds(
            segments,
            overlay_path,
            placed=plan.placed,
            catalog=catalog,
        )
        return {
            "ga_instances": len(instances),
            "gates_placed": len(plan.placed),
            "wire_segments": len(segments),
            "placement_rows": {
                str(row): cols for row, cols in plan.row_usage.items()
            },
            "seed": seed,
            "verified": True,
            "debug_bitmap": str(bitmap_path),
            "io_pads": len(io_bindings),
        }

    raise RuntimeError(
        f"GA layout sync failed after {max_attempts} attempts: {last_error}"
    )


def _all_endpoints(problem: LayoutProblem) -> list[NetEndpoint]:
    out: list[NetEndpoint] = []
    for eps in problem.net_groups.values():
        out.extend(eps)
    return out
