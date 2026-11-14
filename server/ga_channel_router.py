"""METAL5 チャネル配線（端子グリッド規則に基づく構造配線）。"""

from __future__ import annotations

from dataclasses import dataclass

from server.ga_extract import LayoutProblem
from server.ga_obstacles import WIRE_WIDTH_UM
from server.ga_placement import PlacedGate, _cell_lookup
from server.ga_router import WireSegment
from server.ga_terminals import (
    ROW_STITCH_LOWER_Y,
    ROW_STITCH_UPPER_Y,
    VDD_BUS_Y,
    VDD_TIE_Y,
    VSS_BUS_Y,
    VSS_TIE_Y,
    net_kind,
    pick_routing_track,
    pin_absolute_x,
)


@dataclass(frozen=True)
class RoutedPin:
    component_ref: str
    gate_instance: str
    gate_pin: str
    net_key: str
    row: int
    col: int
    abs_x: float
    origin_y: float


def _h_seg(x0: float, x1: float, y: float) -> WireSegment:
    return WireSegment(x0, y, x1, y, WIRE_WIDTH_UM)


def _v_seg(x: float, y0: float, y1: float) -> WireSegment:
    return WireSegment(x, y0, x, y1, WIRE_WIDTH_UM)


def _seg_key(seg: WireSegment) -> tuple:
    if abs(seg.x0 - seg.x1) < 1e-6:
        return ("v", round(seg.x0, 3), round(min(seg.y0, seg.y1), 3), round(max(seg.y0, seg.y1), 3))
    return ("h", round(min(seg.x0, seg.x1), 3), round(max(seg.x0, seg.x1), 3), round(seg.y0, 3))


def _add_seg(
    segments: list[WireSegment],
    seen: set[tuple],
    seg: WireSegment,
    *,
    net_key: str,
    path_id: int,
) -> None:
    key = _seg_key(seg)
    if key in seen:
        return
    seen.add(key)
    segments.append(
        WireSegment(seg.x0, seg.y0, seg.x1, seg.y1, seg.width_um, net_key, path_id)
    )


def _collect_routed_pins(
    problem: LayoutProblem,
    placed: list[PlacedGate],
    catalog: dict,
) -> dict[str, list[RoutedPin]]:
    cells = _cell_lookup(catalog)
    pg_map = {
        (pg.slot.component_ref, pg.slot.gate_instance): pg for pg in placed
    }
    by_net: dict[str, list[RoutedPin]] = {}

    for net_key, endpoints in problem.net_groups.items():
        pins: list[RoutedPin] = []
        for ep in endpoints:
            pg = pg_map.get((ep.component_ref, ep.gate_instance))
            if pg is None:
                continue
            cell = cells.get((pg.row, pg.col))
            if cell is None:
                continue
            oy = float(cell["origin"]["y"])
            abs_x = pin_absolute_x(float(cell["origin"]["x"]), ep.gate_pin, catalog)
            pins.append(
                RoutedPin(
                    component_ref=ep.component_ref,
                    gate_instance=ep.gate_instance,
                    gate_pin=ep.gate_pin,
                    net_key=net_key,
                    row=pg.row,
                    col=pg.col,
                    abs_x=abs_x,
                    origin_y=oy,
                )
            )
        if pins:
            by_net[net_key] = pins
    return by_net


def _group_by_row(pins: list[RoutedPin]) -> dict[int, list[RoutedPin]]:
    by_row: dict[int, list[RoutedPin]] = {}
    for pin in pins:
        by_row.setdefault(pin.row, []).append(pin)
    return by_row


def _stitch_x(row_pins: list[RoutedPin]) -> float:
    xs = [p.abs_x for p in row_pins]
    return sum(xs) / len(xs)


def _route_signal_net(pins: list[RoutedPin], net_key: str) -> list[WireSegment]:
    segments: list[WireSegment] = []
    seen: set[tuple] = set()
    track = pick_routing_track()
    by_row = _group_by_row(pins)
    rows = sorted(by_row)
    path_id = 1

    for row in rows:
        row_pins = by_row[row]
        xs = [p.abs_x for p in row_pins]
        oy = row_pins[0].origin_y
        y = oy + track
        _add_seg(segments, seen, _h_seg(min(xs), max(xs), y), net_key=net_key, path_id=path_id)
        path_id += 1

    for i in range(len(rows) - 1):
        upper = by_row[rows[i]]
        lower = by_row[rows[i + 1]]
        if rows[i + 1] != rows[i] + 1:
            continue
        x = (_stitch_x(upper) + _stitch_x(lower)) / 2.0
        oy_u = upper[0].origin_y
        oy_l = lower[0].origin_y
        y_track_u = oy_u + track
        y_track_l = oy_l + track
        y_stitch_u = oy_u + ROW_STITCH_UPPER_Y
        y_stitch_l = oy_l + ROW_STITCH_LOWER_Y
        for seg in (
            _v_seg(x, y_track_u, y_stitch_u),
            _v_seg(x, y_stitch_u, y_stitch_l),
            _v_seg(x, y_stitch_l, y_track_l),
        ):
            _add_seg(segments, seen, seg, net_key=net_key, path_id=path_id)
            path_id += 1

    return segments


def _route_vdd_net(pins: list[RoutedPin], net_key: str) -> list[WireSegment]:
    segments: list[WireSegment] = []
    seen: set[tuple] = set()
    by_row = _group_by_row(pins)
    rows = sorted(by_row)
    path_id = 1

    for row in rows:
        row_pins = by_row[row]
        oy = row_pins[0].origin_y
        bus_y = oy + VDD_BUS_Y
        y_lo, y_hi = VDD_TIE_Y
        for pin in row_pins:
            _add_seg(
                segments,
                seen,
                _v_seg(pin.abs_x, oy + y_lo, oy + y_hi),
                net_key=net_key,
                path_id=path_id,
            )
            path_id += 1
        xs = [p.abs_x for p in row_pins]
        _add_seg(
            segments,
            seen,
            _h_seg(min(xs), max(xs), bus_y),
            net_key=net_key,
            path_id=path_id,
        )
        path_id += 1

    return segments


def _route_vss_net(pins: list[RoutedPin], net_key: str) -> list[WireSegment]:
    segments: list[WireSegment] = []
    seen: set[tuple] = set()
    by_row = _group_by_row(pins)
    rows = sorted(by_row)
    path_id = 1

    for row in rows:
        row_pins = by_row[row]
        oy = row_pins[0].origin_y
        bus_y = oy + VSS_BUS_Y
        y_lo, y_hi = VSS_TIE_Y
        for pin in row_pins:
            _add_seg(
                segments,
                seen,
                _v_seg(pin.abs_x, oy + y_lo, oy + y_hi),
                net_key=net_key,
                path_id=path_id,
            )
            path_id += 1
        xs = [p.abs_x for p in row_pins]
        _add_seg(
            segments,
            seen,
            _h_seg(min(xs), max(xs), bus_y),
            net_key=net_key,
            path_id=path_id,
        )
        path_id += 1

    return segments


def route_power_nets(
    problem: LayoutProblem,
    placed: list[PlacedGate],
    catalog: dict,
) -> list[WireSegment]:
    """VDD/VSS をチャネル規則で配線（base.gds バス上へのオーバーレイ可）。"""
    by_net = _collect_routed_pins(problem, placed, catalog)
    all_segments: list[WireSegment] = []

    for net_key, pins in sorted(by_net.items(), key=lambda item: item[0]):
        if len(pins) < 2:
            continue
        kind = net_kind(net_key)
        if kind == "vdd":
            all_segments.extend(_route_vdd_net(pins, net_key))
        elif kind == "vss":
            all_segments.extend(_route_vss_net(pins, net_key))

    return all_segments


def route_channel(
    problem: LayoutProblem,
    placed: list[PlacedGate],
    catalog: dict,
) -> list[WireSegment]:
    """端子グリッド規則に従い全ネットを配線する。"""
    by_net = _collect_routed_pins(problem, placed, catalog)
    all_segments: list[WireSegment] = []

    def sort_key(item: tuple[str, list[RoutedPin]]) -> tuple[int, str]:
        kind = net_kind(item[0])
        order = {"signal": 0, "vdd": 1, "vss": 2}
        return (order.get(kind, 0), item[0])

    for net_key, pins in sorted(by_net.items(), key=sort_key):
        if len(pins) < 2:
            continue
        kind = net_kind(net_key)
        if kind == "vdd":
            all_segments.extend(_route_vdd_net(pins, net_key))
        elif kind == "vss":
            all_segments.extend(_route_vss_net(pins, net_key))
        else:
            all_segments.extend(_route_signal_net(pins, net_key))

    return all_segments
