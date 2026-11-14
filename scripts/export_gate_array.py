#!/usr/bin/env python3
"""base.gds からゲートアレイ配置メタデータ (public/fab/gate-array.json) を生成する。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import klayout.db as db

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.ga_terminals import TERMINAL_GRID
from server.ga_io_pads import GA_IN_PADS, GA_OUT_PADS

DEFAULT_GDS = ROOT / "public" / "base.gds"
OUTPUT_JSON = ROOT / "public" / "fab" / "gate-array.json"

ROWS = 9
COLS = 35

# KLayout: dbbox() は µm、インスタンス変位・シェープ座標は nm
NM_TO_UM = 1e-3


def _cell_bbox_um(cell: db.Cell) -> tuple[float, float, float, float]:
    bb = cell.dbbox()
    return float(bb.left), float(bb.bottom), float(bb.right), float(bb.top)


def _detect_grid_origin_um(top: db.Cell) -> tuple[float, float]:
    """GA_R0_C0 の左下角 [µm]。Z__GABASECELL 参照配置から取得。"""
    for inst in top.each_inst():
        if inst.cell.name == "Z__GABASECELL":
            d = inst.trans.disp
            return round(d.x * NM_TO_UM, 3), round(d.y * NM_TO_UM, 3)
    raise ValueError(
        "Z__GABASECELL instance not found in top cell — cannot anchor gate array grid"
    )


def _detect_row_pitch_um(top: db.Cell) -> float:
    """ga_top_JUMPLINE1_M4 インスタンス間隔から行ピッチ [µm] を検出する。

    base.gds の行間隔は 580 µm（セル高 150 µm + 行間 430 µm）。
    チップ高さの等分割 (≈532 µm) とは一致しないため実測値を使う。
    """
    ys = sorted(
        round(inst.trans.disp.y * NM_TO_UM, 6)
        for inst in top.each_inst()
        if inst.cell.name == "ga_top_JUMPLINE1_M4"
    )
    if len(ys) < 2:
        raise ValueError(
            "ga_top_JUMPLINE1_M4 instances not found — cannot detect row pitch"
        )
    diffs = [round(ys[i + 1] - ys[i], 6) for i in range(len(ys) - 1)]
    pitch_y = max(set(diffs), key=diffs.count)
    if pitch_y < 150.0:
        raise ValueError(f"Detected row pitch {pitch_y} µm looks too small")
    return pitch_y


def _m5_centroids(cell: db.Cell, layout: db.Layout) -> list[tuple[float, float]]:
    li = layout.find_layer(33, 0)
    if li is None:
        return []
    out: list[tuple[float, float]] = []
    it = cell.begin_shapes_rec(li)
    while not it.at_end():
        shape = it.shape()
        if shape.is_box():
            box = shape.box.transformed(it.trans())
            cx = (box.left + box.right) / 2 * NM_TO_UM
            cy = (box.bottom + box.top) / 2 * NM_TO_UM
            out.append((round(cx, 3), round(cy, 3)))
        it.next()
    out.sort()
    return out


def _terminal_template() -> list[dict]:
    """各信号 pin × 6 Y 端子のローカル座標テンプレート。"""
    pin_x = TERMINAL_GRID["pinX"]
    terminal_y = TERMINAL_GRID["terminalY"]
    layer = {"layer": 33, "datatype": 0, "name": "METAL5"}
    out: list[dict] = []
    for pin_name, x in pin_x.items():
        for y in terminal_y:
            out.append(
                {
                    "name": f"{pin_name}@{int(y)}",
                    "pin": pin_name,
                    "trackY": y,
                    "position": {"x": x, "y": y},
                    "layer": layer,
                }
            )
    return out


def _io_pads_payload() -> dict:
    def _table(pads: dict[int, tuple[float, float]]) -> dict:
        return {
            str(i): {"x": x, "y": y}
            for i, (x, y) in sorted(pads.items())
        }

    return {"in": _table(GA_IN_PADS), "out": _table(GA_OUT_PADS)}


def _global_routing_payload() -> dict:
    return {
        "vddBusY": TERMINAL_GRID["vddBusY"],
        "vssBusY": TERMINAL_GRID["vssBusY"],
        "rowCrossingY": TERMINAL_GRID["rowCrossingY"],
        "intraRowTracks": TERMINAL_GRID["routingTracks"],
        "jumperPinX": TERMINAL_GRID["jumperPinX"],
        "ioBoundaryXUm": 5700.0,
        "ioStagingXUm": 5700.0,
        "ioPadXUm": 5797.0,
        "notes": (
            "VDD/VSS buses span each cell row at vddBusY/vssBusY (including X>=5700). "
            "Cross-row and I/O nets must use rowCrossingY (5/145) terminals. "
            "At jumperPinX columns, Y=5 and Y=145 are vertically connected "
            "via lower metal and may be used as jumpers. "
            "I/O routing: grid A* for X<ioBoundaryXUm, then off-grid Manhattan to pads."
        ),
    }


def export_gate_array(
    gds_path: Path = DEFAULT_GDS,
    output_path: Path = OUTPUT_JSON,
    *,
    rows: int = ROWS,
    cols: int = COLS,
) -> dict:
    if not gds_path.is_file():
        raise FileNotFoundError(f"GDS not found: {gds_path}")

    layout = db.Layout()
    layout.read(str(gds_path))
    top = layout.top_cell()
    top_bb = top.dbbox()

    top_left = float(top_bb.left)
    top_bottom = float(top_bb.bottom)
    top_right = float(top_bb.right)
    top_top = float(top_bb.top)
    width = top_right - top_left
    height = top_top - top_bottom

    grid_ox, grid_oy = _detect_grid_origin_um(top)
    margin_x = grid_ox - top_left
    margin_y = grid_oy - top_bottom

    base_cell = layout.cell("Z__GABASECELL")
    cell_l, cell_b, cell_r, cell_t = _cell_bbox_um(base_cell)
    cell_w = cell_r - cell_l
    cell_h = cell_t - cell_b

    # 列: セル幅でタイル / 行: base.gds の VSS バス間隔から実測
    pitch_x = cell_w
    pitch_y = _detect_row_pitch_um(top)

    terminal_template = _terminal_template()

    cells: list[dict] = []
    for row in range(rows):
        for col in range(cols):
            origin_x = grid_ox + col * pitch_x
            origin_y = grid_oy + row * pitch_y
            cell_id = f"GA_R{row}_C{col}"
            cells.append(
                {
                    "id": cell_id,
                    "row": row,
                    "col": col,
                    "index": row * cols + col,
                    "origin": {
                        "x": round(origin_x, 3),
                        "y": round(origin_y, 3),
                    },
                    "size": {"width": round(cell_w, 3), "height": round(cell_h, 3)},
                }
            )

    payload = {
        "version": 2,
        "description": (
            "Agile-X gate array placement metadata for base.gds "
            "(8 signal pins × 6 Y terminals + VDD/VSS buses + global routing)"
        ),
        "units": "um",
        "baseGds": {
            "path": str(gds_path.relative_to(ROOT)),
            "fileName": gds_path.name,
            "topCell": top.name,
            "bbox": [
                round(top_left, 3),
                round(top_bottom, 3),
                round(top_right, 3),
                round(top_top, 3),
            ],
        },
        "gateArray": {
            "cellName": "Z__GABASECELL",
            "totalCount": rows * cols,
            "rows": rows,
            "columnsPerRow": cols,
            "indexOrigin": "bottom-left",
            "indexOrder": "row-major",
        },
        "grid": {
            "origin": {"x": round(grid_ox, 3), "y": round(grid_oy, 3)},
            "topOrigin": {"x": round(top_left, 3), "y": round(top_bottom, 3)},
            "margin": {"x": round(margin_x, 3), "y": round(margin_y, 3)},
            "pitch": {"x": round(pitch_x, 6), "y": round(pitch_y, 6)},
            "siteSize": {"width": round(cell_w, 3), "height": round(cell_h, 3)},
        },
        "baseCell": {
            "name": "Z__GABASECELL",
            "bbox": [round(cell_l, 3), round(cell_b, 3), round(cell_r, 3), round(cell_t, 3)],
            "size": {"width": round(cell_w, 3), "height": round(cell_h, 3)},
            "terminalGrid": TERMINAL_GRID,
            "terminalTemplate": terminal_template,
            "metal5AccessPoints": [
                {"x": x, "y": y} for x, y in _m5_centroids(base_cell, layout)
            ],
        },
        "globalRouting": _global_routing_payload(),
        "ioPads": _io_pads_payload(),
        "cells": cells,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {output_path} ({rows}×{cols}={rows * cols} cells, "
        f"grid origin ({grid_ox:.3f},{grid_oy:.3f}) µm, "
        f"pitch {pitch_x:.3f}×{pitch_y:.3f} µm, "
        f"{len(terminal_template)} terminals/cell template)"
    )
    return payload


def main() -> int:
    gds = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_GDS
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT_JSON
    export_gate_array(gds, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
