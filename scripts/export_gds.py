#!/usr/bin/env python3
"""gdsfactory で GDS を読み込み、表示用レイヤ JSON を生成する。"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

import gdsfactory as gf

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GDS = ROOT / "public" / "base.gds"
OUTPUT_JSON = ROOT / "public" / "gds" / "base.json"
OUTPUT_GZ = ROOT / "public" / "gds" / "base.json.gz"

# layer/datatype → 表示名
DISPLAY_LAYERS: dict[tuple[int, int], tuple[str, str]] = {
    (31, 0): ("METAL4", "#e8a838"),
    (32, 0): ("VIA45", "#6b8cff"),
    (33, 0): ("METAL5", "#38d4a8"),
}


def export_gds(gds_path: Path, output_json: Path, output_gz: Path) -> None:
    if not gds_path.is_file():
        raise FileNotFoundError(f"GDS not found: {gds_path}")

    component = gf.import_gds(gds_path)
    bbox = component.bbox()
    polygons_by_layer = component.get_polygons(by="tuple")

    payload: dict = {
        "title": gds_path.name,
        "source": str(gds_path.name),
        "bbox": [bbox.left, bbox.bottom, bbox.right, bbox.top],
        "layers": [],
    }

    for (layer, datatype), (name, color) in DISPLAY_LAYERS.items():
        polys = polygons_by_layer.get((layer, datatype), [])
        flat_polys: list[list[int]] = []
        for poly in polys:
            ring: list[int] = []
            for pt in poly.each_point_hull():
                ring.extend((int(pt.x), int(pt.y)))
            if len(ring) >= 6:
                flat_polys.append(ring)

        payload["layers"].append(
            {
                "name": name,
                "layer": layer,
                "datatype": datatype,
                "color": color,
                "polygons": flat_polys,
            }
        )
        print(f"  {name} ({layer}/{datatype}): {len(flat_polys)} polygons")

    out_dir = output_json.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    output_json.write_bytes(raw)
    output_gz.write_bytes(gzip.compress(raw, compresslevel=6))
    print(f"Wrote {output_json} ({len(raw) / 1e6:.1f} MB)")
    print(f"Wrote {output_gz} ({output_gz.stat().st_size / 1e6:.1f} MB gzip)")


def main() -> int:
    gds_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_GDS
    output_json = Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT_JSON
    output_gz = (
        Path(sys.argv[3])
        if len(sys.argv) > 3
        else output_json.with_suffix(output_json.suffix + ".gz")
    )
    print(f"Exporting {gds_path} via gdsfactory {gf.__version__}...")
    export_gds(gds_path, output_json, output_gz)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
