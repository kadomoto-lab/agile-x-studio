"""Z__GABASECELL の METAL5 端子グリッド定義と座標解決。"""

from __future__ import annotations

from server.ga_obstacles import snap_point_um
from server.ga_placement import PlacedGate, _cell_lookup

# ローカル座標 [µm] — export_gate_array.py と同期
SIGNAL_PIN_X: dict[str, float] = {
    "P3": 45.0,
    "P2": 55.0,
    "P1": 65.0,
    "G1": 75.0,
    "G2": 85.0,
    "N3": 95.0,
    "N2": 105.0,
    "N1": 115.0,
}

TERMINAL_Y: tuple[float, ...] = (5.0, 25.0, 65.0, 85.0, 125.0, 145.0)
ROUTING_TRACKS: tuple[float, ...] = (25.0, 65.0, 85.0, 125.0)
# VDD/VSS バスをまたぐ行跨ぎ・I/O 配線用端子（同一セル内 Y=5↔145 はジャンパで接続）
ROW_CROSSING_Y: tuple[float, ...] = (5.0, 145.0)
JUMPER_PIN_X: tuple[float, ...] = (5.0, 15.0, 25.0, 35.0, 125.0, 135.0, 145.0, 155.0)
VDD_BUS_Y = 135.0
VSS_BUS_Y = 15.0
VDD_TIE_Y: tuple[float, float] = (125.0, 145.0)
VSS_TIE_Y: tuple[float, float] = (5.0, 25.0)
ROW_STITCH_UPPER_Y = 145.0
ROW_STITCH_LOWER_Y = 5.0

TERMINAL_GRID: dict = {
    "signalPins": list(SIGNAL_PIN_X.keys()),
    "pinX": SIGNAL_PIN_X,
    "terminalY": list(TERMINAL_Y),
    "routingTracks": list(ROUTING_TRACKS),
    "rowCrossingY": list(ROW_CROSSING_Y),
    "jumperPinX": list(JUMPER_PIN_X),
    "vddBusY": VDD_BUS_Y,
    "vssBusY": VSS_BUS_Y,
    "vddTieY": list(VDD_TIE_Y),
    "vssTieY": list(VSS_TIE_Y),
    "rowStitchY": [ROW_STITCH_UPPER_Y, ROW_STITCH_LOWER_Y],
}

_DEFAULT_GLOBAL_ROUTING: dict = {
    "vddBusY": VDD_BUS_Y,
    "vssBusY": VSS_BUS_Y,
    "rowCrossingY": list(ROW_CROSSING_Y),
    "intraRowTracks": list(ROUTING_TRACKS),
    "jumperPinX": list(JUMPER_PIN_X),
    "ioBoundaryXUm": 5700.0,
    "ioStagingXUm": 5700.0,
    "ioPadXUm": 5797.0,
}


def global_routing_from_catalog(catalog: dict) -> dict:
    gr = catalog.get("globalRouting")
    if gr is not None:
        return gr
    tg = terminal_grid_from_catalog(catalog)
    return {
        "vddBusY": float(tg.get("vddBusY", VDD_BUS_Y)),
        "vssBusY": float(tg.get("vssBusY", VSS_BUS_Y)),
        "rowCrossingY": list(tg.get("rowCrossingY", ROW_CROSSING_Y)),
        "intraRowTracks": list(tg.get("routingTracks", ROUTING_TRACKS)),
        "jumperPinX": list(tg.get("jumperPinX", JUMPER_PIN_X)),
        "ioBoundaryXUm": float(_DEFAULT_GLOBAL_ROUTING["ioBoundaryXUm"]),
        "ioStagingXUm": float(_DEFAULT_GLOBAL_ROUTING["ioStagingXUm"]),
        "ioPadXUm": float(_DEFAULT_GLOBAL_ROUTING["ioPadXUm"]),
    }


def io_pads_from_catalog(catalog: dict) -> tuple[dict[int, tuple[float, float]], dict[int, tuple[float, float]]]:
    """(ga_in, ga_out) パッド座標 [µm]。"""
    pads = catalog.get("ioPads")
    if pads is None:
        from server.ga_io_pads import GA_IN_PADS, GA_OUT_PADS

        return dict(GA_IN_PADS), dict(GA_OUT_PADS)
    def _parse(table: dict) -> dict[int, tuple[float, float]]:
        out: dict[int, tuple[float, float]] = {}
        for key, val in table.items():
            idx = int(key) if isinstance(key, str) else int(key)
            pos = val.get("position", val) if isinstance(val, dict) else val
            out[idx] = (float(pos["x"]), float(pos["y"]))
        return out

    return _parse(pads.get("in", {})), _parse(pads.get("out", {}))


def terminal_grid_from_catalog(catalog: dict) -> dict:
    grid = catalog.get("baseCell", {}).get("terminalGrid")
    if grid is not None:
        return grid
    return TERMINAL_GRID


def pin_absolute_x(origin_x: float, gate_pin: str, catalog: dict) -> float:
    pin_x = terminal_grid_from_catalog(catalog)["pinX"]
    if gate_pin not in pin_x:
        raise KeyError(f"Unknown gate pin: {gate_pin}")
    return origin_x + float(pin_x[gate_pin])


def pick_routing_track() -> float:
    """信号配線トラック（25/65/85/125）の代表値。"""
    return ROUTING_TRACKS[1]  # 65 µm


def signal_track_y(gate_pin: str) -> float:
    """pin 役割ごとのデフォルト routing track（ローカル Y [µm]）。"""
    if gate_pin in ("G1", "G2"):
        return ROUTING_TRACKS[1]  # 65 — 入力
    if gate_pin in ("N2", "P2"):
        return ROUTING_TRACKS[2]  # 85 — 出力
    if gate_pin in ("N1", "N3"):
        return ROUTING_TRACKS[0]  # 25 — VSS 系アクセス
    if gate_pin in ("P1", "P3"):
        return ROUTING_TRACKS[3]  # 125 — VDD 系アクセス
    return pick_routing_track()


def endpoint_xy(
    origin_x: float,
    origin_y: float,
    gate_pin: str,
    net_key: str,
) -> tuple[float, float]:
    pin_x = float(SIGNAL_PIN_X[gate_pin])
    kind = net_kind(net_key)
    if kind == "vdd":
        return origin_x + pin_x, origin_y + VDD_BUS_Y
    if kind == "vss":
        return origin_x + pin_x, origin_y + VSS_BUS_Y
    return origin_x + pin_x, origin_y + signal_track_y(gate_pin)


def assign_endpoint_coordinates(
    problem,
    placed: list[PlacedGate],
    catalog: dict,
) -> None:
    """LayoutProblem の各端点に絶対座標 [µm] を設定する。"""
    cells = _cell_lookup(catalog)
    pg_map = {
        (pg.slot.component_ref, pg.slot.gate_instance): pg for pg in placed
    }
    pin_names = set(SIGNAL_PIN_X)

    for endpoints in problem.net_groups.values():
        for ep in endpoints:
            if ep.gate_pin not in pin_names:
                continue
            pg = pg_map.get((ep.component_ref, ep.gate_instance))
            if pg is None:
                continue
            cell = cells.get((pg.row, pg.col))
            if cell is None:
                continue
            ox = float(cell["origin"]["x"])
            oy = float(cell["origin"]["y"])
            raw_x, raw_y = endpoint_xy(ox, oy, ep.gate_pin, ep.net_key)
            ep.x, ep.y = snap_point_um(raw_x, raw_y, 0.0, 0.0)
            ep.origin_y = oy


def net_kind(net_key: str) -> str:
    if net_key == "g:VDD":
        return "vdd"
    if net_key in ("g:VSS", "g:0"):
        return "vss"
    return "signal"


def resolve_pin_positions(
    placed: list[PlacedGate],
    catalog: dict,
) -> dict[tuple[str, str, str], tuple[float, float]]:
    """(component_ref, gate_instance, gate_pin) → 代表端子 (x, y) [信号トラック]。"""
    cells = _cell_lookup(catalog)
    track = pick_routing_track()
    pin_x = terminal_grid_from_catalog(catalog)["pinX"]
    positions: dict[tuple[str, str, str], tuple[float, float]] = {}
    for pg in placed:
        cell = cells.get((pg.row, pg.col))
        if cell is None:
            continue
        ox = float(cell["origin"]["x"])
        oy = float(cell["origin"]["y"])
        for pin_name in pin_x:
            key = (pg.slot.component_ref, pg.slot.gate_instance, pin_name)
            positions[key] = (ox + float(pin_x[pin_name]), oy + track)
    return positions


def cell_origin(catalog: dict, row: int, col: int) -> tuple[float, float]:
    cell = _cell_lookup(catalog)[(row, col)]
    return float(cell["origin"]["x"]), float(cell["origin"]["y"])
