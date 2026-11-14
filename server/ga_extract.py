"""プリミティブ定義からゲート展開・接続関係を構築する。"""

from __future__ import annotations

from dataclasses import dataclass, field

from server.fab import get_primitive_by_subckt
from server.ga_netlist import GaInstance


@dataclass
class GateSlot:
    component_ref: str
    subckt: str
    gate_instance: str
    gate_index: int


@dataclass
class PlacedGate:
    slot: GateSlot
    row: int
    col: int
    cell_id: str


@dataclass
class NetEndpoint:
    """ルーティング端点（絶対座標は配置後に解決）。"""

    component_ref: str
    gate_instance: str
    gate_pin: str
    net_key: str
    x: float = 0.0
    y: float = 0.0
    origin_y: float = 0.0
    """配置セル原点 Y [µm]。routingTracks 上の端子座標解決に使う。"""


@dataclass
class LayoutProblem:
    instances: list[GaInstance]
    gate_slots: list[GateSlot]
    """同一 net_key の端点はすべて接続する。"""
    net_groups: dict[str, list[NetEndpoint]] = field(default_factory=dict)
    """ゲート内 metal5Ties / interGate 由来の必須ペア接続。"""
    required_pairs: list[tuple[str, str]] = field(default_factory=list)


def _global_net_key(instance: GaInstance, primitive_pin: str | None, local_net: str) -> str:
    if primitive_pin:
        return f"g:{instance.nets[primitive_pin]}"
    return f"l:{instance.ref}:{local_net}"


def _endpoint_id(component_ref: str, gate_instance: str, gate_pin: str) -> str:
    return f"{component_ref}:{gate_instance}:{gate_pin}"


def build_layout_problem(instances: list[GaInstance]) -> LayoutProblem:
    gate_slots: list[GateSlot] = []
    net_groups: dict[str, list[NetEndpoint]] = {}
    required_pairs: list[tuple[str, str]] = []
    endpoints_by_id: dict[str, NetEndpoint] = {}

    def add_endpoint(
        instance: GaInstance,
        gate_instance: str,
        gate_pin: str,
        primitive_pin: str | None,
        local_net: str,
    ) -> str:
        eid = _endpoint_id(instance.ref, gate_instance, gate_pin)
        if eid not in endpoints_by_id:
            net_key = _global_net_key(instance, primitive_pin, local_net)
            ep = NetEndpoint(
                component_ref=instance.ref,
                gate_instance=gate_instance,
                gate_pin=gate_pin,
                net_key=net_key,
            )
            endpoints_by_id[eid] = ep
            net_groups.setdefault(net_key, []).append(ep)
        return eid

    for instance in instances:
        primitive = get_primitive_by_subckt(instance.subckt)
        if primitive is None:
            continue
        for gate in primitive.get("gates", []):
            gate_slots.append(
                GateSlot(
                    component_ref=instance.ref,
                    subckt=instance.subckt,
                    gate_instance=gate["instance"],
                    gate_index=int(gate["gateIndex"]),
                )
            )
            pin_map = {m["gatePin"]: m for m in gate.get("pinMap", [])}
            for tie in gate.get("metal5Ties", []):
                pins = tie.get("gatePins", [])
                ids = [
                    add_endpoint(
                        instance,
                        gate["instance"],
                        gp,
                        pin_map[gp].get("primitivePin"),
                        pin_map[gp]["net"],
                    )
                    for gp in pins
                ]
                for i in range(1, len(ids)):
                    required_pairs.append((ids[0], ids[i]))

        for link in primitive.get("interGateMetal5", []):
            from_gate = link["from"]["gateInstance"]
            to_gate = link["to"]["gateInstance"]
            from_net = link["from"].get("net")
            to_pin = link["to"].get("gatePin")
            from_gate_def = next(
                g for g in primitive["gates"] if g["instance"] == from_gate
            )
            to_gate_def = next(g for g in primitive["gates"] if g["instance"] == to_gate)
            from_map = {m["gatePin"]: m for m in from_gate_def.get("pinMap", [])}
            to_map = {m["gatePin"]: m for m in to_gate_def.get("pinMap", [])}
            if from_net:
                from_pins = [
                    gp
                    for gp, m in from_map.items()
                    if m["net"] == from_net
                ]
                from_id = add_endpoint(
                    instance,
                    from_gate,
                    from_pins[0],
                    from_map[from_pins[0]].get("primitivePin"),
                    from_net,
                )
            else:
                from_pin = link["from"].get("gatePin")
                m = from_map[from_pin]
                from_id = add_endpoint(
                    instance,
                    from_gate,
                    from_pin,
                    m.get("primitivePin"),
                    m["net"],
                )
            m = to_map[to_pin]
            to_id = add_endpoint(
                instance,
                to_gate,
                to_pin,
                m.get("primitivePin"),
                m["net"],
            )
            required_pairs.append((from_id, to_id))

    return LayoutProblem(
        instances=instances,
        gate_slots=gate_slots,
        net_groups=net_groups,
        required_pairs=required_pairs,
    )
