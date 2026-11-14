"""ブロック図 → ネットリスト / GDS レイアウト同期（gdsfactory）。"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import gdsfactory as gf

from server.fab import get_base_forfab_gds_path, get_base_gds_path

ROOT = Path(__file__).resolve().parents[1]
BASE_GDS = get_base_gds_path()
GENERATED_DIR = ROOT / "public" / "generated"
OVERLAY_GDS = GENERATED_DIR / "schematic_overlay.gds"
COMBINED_GDS = GENERATED_DIR / "combined.gds"
COMBINED_FORFAB_GDS = GENERATED_DIR / "combined_forfab.gds"
# 仮ルーティング: (145,4865) — (145,4885), 幅 5 µm, METAL5
STUB_PATH = {
    "x": 145.0,
    "y1": 4865.0,
    "y2": 4885.0,
    "width_um": 5.0,
    "layer": (33, 0),
}


def generate_stub_overlay(
    output: Path = OVERLAY_GDS,
    *,
    x: float = STUB_PATH["x"],
    y1: float = STUB_PATH["y1"],
    y2: float = STUB_PATH["y2"],
    width_um: float = STUB_PATH["width_um"],
    layer: tuple[int, int] = STUB_PATH["layer"],
) -> Path:
    """(x,y1)—(x,y2) を width_um の METAL5 パス（矩形ワイヤ）で接続する GDS を生成。"""
    output.parent.mkdir(parents=True, exist_ok=True)
    length = abs(y2 - y1)
    y0 = min(y1, y2)

    c = gf.Component("schematic_overlay")
    wire = c << gf.components.rectangle(size=(width_um, length), layer=layer)
    wire.move((x - width_um / 2, y0))
    # with_metadata=False: KLayout 専用の $$$CONTEXT_INFO$$$ セルを書かない
    # （他の GDS リーダーが Invalid record エラーを出すため）
    c.write_gds(output, with_metadata=False)
    return output


def merge_gds(
    base_path: Path,
    overlay_path: Path,
    output: Path,
    *,
    top_cell_name: str = "agilex_combined",
    overlay_offset: tuple[float, float] = (0.0, 0.0),
) -> Path:
    """base GDS と overlay を重畳して出力する。

    base.gds と base_forfab.gds を同一プロセスで続けてマージすると、
    両者が共有するセル名が gdsfactory のキャッシュで衝突・流用され、
    2 つ目のジオメトリが 1 つ目のもので置き換わって「ズレ」に見える。
    マージ前にキャッシュをクリアし、各マージを完全に独立させる。

    overlay_offset: overlay 側だけを (dx, dy) [µm] 平行移動して配置する。
    forfab の座標系に合わせるために使う（base 側は (0, 0) のまま）。
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    gf.clear_cache()
    base = gf.import_gds(base_path)
    overlay = gf.import_gds(overlay_path)

    top = gf.Component(top_cell_name)
    top << base
    overlay_ref = top << overlay
    overlay_ref.move(overlay_offset)
    # 一時ファイルに書いてから置き換える（描画 API が書きかけのファイルを読まないように）
    tmp = output.with_name(output.stem + ".tmp" + output.suffix)
    top.write_gds(tmp, with_metadata=False)
    os.replace(tmp, output)
    return output


def sync_layout_from_netlist(netlist: str) -> dict[str, str | int]:
    """ネットリストを受け取り、GA 配置・METAL5 迷路配線 → オーバーレイ GDS → 重畳。"""
    if not BASE_GDS.is_file():
        raise FileNotFoundError(f"base GDS not found: {BASE_GDS}")

    # 同一 uvicorn プロセス内で 2 回目以降の同期時にセル名が衝突しないようクリア
    gf.clear_cache()

    from server.ga_sync import sync_ga_layout

    ga_info = sync_ga_layout(netlist, OVERLAY_GDS)
    merge_gds(BASE_GDS, OVERLAY_GDS, COMBINED_GDS)
    merge_gds(
        get_base_forfab_gds_path(),
        OVERLAY_GDS,
        COMBINED_FORFAB_GDS,
        top_cell_name="agilex_combined_forfab",
        overlay_offset=(-2900.0, -2900.0),
    )
    digest = hashlib.sha256(COMBINED_GDS.read_bytes()).hexdigest()[:12]
    return {
        "status": "ok",
        "revision": int(digest, 16) % 1_000_000_000,
        "overlay_gds": str(OVERLAY_GDS.relative_to(ROOT)),
        "combined_gds": str(COMBINED_GDS.relative_to(ROOT)),
        "combined_forfab_gds": str(COMBINED_FORFAB_GDS.relative_to(ROOT)),
        "ga_instances": ga_info.get("ga_instances", 0),
        "gates_placed": ga_info.get("gates_placed", 0),
        "wire_segments": ga_info.get("wire_segments", 0),
        "placement_rows": ga_info.get("placement_rows", {}),
    }
