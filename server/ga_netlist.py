"""SPICE ネットリストからゲートアレイ利用素子を抽出する。"""

from __future__ import annotations

from dataclasses import dataclass

from server.fab import get_primitive_by_subckt

GA_SUBCKTS_WITH_GATES = frozenset({"INV", "NOR2", "NAND2", "Z__GABASECELL"})
# SPICE プリアンブル内の固定实例名（トップレベル漏れ対策）
_INTERNAL_GA_REFS = frozenset({"BC", "_BC"})


@dataclass(frozen=True)
class GaInstance:
    ref: str
    subckt: str
    """external pin name → schematic net name"""
    nets: dict[str, str]


def _external_pin_names(primitive: dict) -> list[str]:
    return [p["name"] for p in primitive.get("externalPins", [])]


def _strip_comment(raw: str) -> str:
    return raw.split("*", 1)[0].strip()


def _is_subckt_start(line: str) -> bool:
    return line.lower().startswith(".subckt")


def _is_subckt_end(line: str) -> bool:
    return line.lower().startswith(".ends")


def parse_ga_instances(netlist: str) -> list[GaInstance]:
    """トップレベルの X インスタンスのみ抽出（.SUBCKT 定義内は無視）。"""
    instances: list[GaInstance] = []
    subckt_depth = 0

    for raw in netlist.splitlines():
        line = _strip_comment(raw)
        if not line:
            continue

        if _is_subckt_start(line):
            subckt_depth += 1
            continue
        if _is_subckt_end(line):
            subckt_depth = max(0, subckt_depth - 1)
            continue

        # .model / .tran / .end など、およびサブサーキット内部
        if line.startswith(".") or subckt_depth > 0:
            continue

        tokens = line.split()
        if not tokens or not tokens[0].upper().startswith("X"):
            continue
        ref = tokens[0][1:]
        subckt = tokens[-1]
        if ref in _INTERNAL_GA_REFS and subckt == "Z__GABASECELL":
            continue
        if subckt not in GA_SUBCKTS_WITH_GATES:
            continue
        primitive = get_primitive_by_subckt(subckt)
        if primitive is None or int(primitive.get("gateCount", 0)) < 1:
            continue
        pin_names = _external_pin_names(primitive)
        net_tokens = tokens[1:-1]
        if len(net_tokens) != len(pin_names):
            continue
        instances.append(
            GaInstance(ref=ref, subckt=subckt, nets=dict(zip(pin_names, net_tokens)))
        )
    return instances
