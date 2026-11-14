"""レイアウトのサーバ側描画（KLayout の LayoutView で PNG タイルを作る）。

ブラウザには画像だけを返す（Undine と同じ方式）。KLayout（GPL）はサーバが読み込む
Python モジュールとしてだけ使い、ブラウザに配る成果物には含めない。

タイル (level, ix, iy) は [ix*W, (ix+1)*W] × [iy*W, (iy+1)*W] (dbu) を TILE_PX 四方で描く。
W = TILE_PX * 2^level。level 0 は 1 dbu / px。
"""

from __future__ import annotations

import base64
import hashlib
import math
import threading
from collections import OrderedDict
from pathlib import Path

import klayout.db as kdb
import klayout.lay as klay

from server.fab import get_base_gds_path

ROOT = Path(__file__).resolve().parents[1]
COMBINED_GDS = ROOT / "public" / "generated" / "combined.gds"
LYP_PATH = Path(__file__).resolve().parent / "data" / "layers.lyp"

TILE_PX = 512
MAX_LEVEL = 30
CACHE_BYTES = 128 << 20
BACKGROUND = "#0b0f14"
MAX_IMAGE_PX = 4096


def _hexcolor(c: int) -> str:
    return f"#{c & 0xFFFFFF:06x}"


def _bit(mask: str, i: int) -> bool:
    """mask: 16 進文字列。i 番目のレイヤが表示なら True（4 レイヤで 1 桁）。"""
    k = i // 4
    if k >= len(mask):
        return True
    try:
        return bool((int(mask[k], 16) >> (i % 4)) & 1)
    except ValueError:
        return True


def layer_mask_for_test(count: int, hidden: set[int]) -> str:
    """画面（src/lib/layoutView.ts の layerMask）と同じ形のマスク。テスト用。"""
    out = ""
    for k in range((count + 3) // 4):
        digit = sum(1 << b for b in range(4) if k * 4 + b < count and k * 4 + b not in hidden)
        out += f"{digit:x}"
    return out


def current_gds_path() -> Path:
    """表示する GDS: 同期済みなら combined.gds、まだなら base.gds。"""
    return COMBINED_GDS if COMBINED_GDS.is_file() else get_base_gds_path()


def gds_revision(path: Path) -> int:
    """layout.sync_layout_from_netlist が返す revision と同じ計算（ファイル内容の SHA-256）。"""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    return int(digest, 16) % 1_000_000_000


class LayoutRenderer:
    """1 つの GDS を開いた LayoutView。ファイルが変わったら読み直す。

    LayoutView はスレッドセーフではないので、すべての操作を lock の中で行う。
    """

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.lv: klay.LayoutView | None = None
        self.cv = -1
        self.path: Path | None = None
        self.stamp: tuple[int, int] | None = None
        self.revision = 0
        self.cur_mask: str | None = None
        self.cache: OrderedDict[tuple, bytes] = OrderedDict()
        self.cache_bytes = 0
        self._icons: dict[int, str] = {}

    # -------------------------------------------------------------- 読み込み

    def _ensure(self) -> None:
        path = current_gds_path()
        st = path.stat()
        stamp = (st.st_mtime_ns, st.st_size)
        if self.lv is not None and path == self.path and stamp == self.stamp:
            return
        lv = klay.LayoutView(True)
        for k, v in {
            "background-color": BACKGROUND,
            "grid-visible": "false",
            "text-visible": "true",
            "bitmap-oversampling": "1",
            "drop-small-cells": "false",
        }.items():
            lv.set_config(k, v)
        cv = lv.load_layout(str(path), True)
        if LYP_PATH.is_file():
            # add_default=True: lyp にない層も既定の色で表示する
            lv.load_layer_props(str(LYP_PATH), cv, True)
        else:
            lv.add_missing_layers()
        lv.max_hier_levels = 99
        # 読み込みに成功してから差し替える（書き込み途中のファイルなら例外で前の表示を保つ）
        self.lv, self.cv, self.path, self.stamp = lv, cv, path, stamp
        self.revision = gds_revision(path)
        self.cur_mask = None
        self.cache.clear()
        self.cache_bytes = 0
        self._icons = {}

    def _nodes(self):
        assert self.lv is not None
        it = self.lv.begin_layers()
        while not it.at_end():
            node = it.current()
            if not node.has_children():
                yield it.dup(), node
            it.next()

    def _apply_mask(self, mask: str | None) -> None:
        if mask == self.cur_mask:
            return
        for i, (_, node) in enumerate(self._nodes()):
            v = True if mask is None else _bit(mask, i)
            if node.visible != v:
                node.visible = v
        self.cur_mask = mask

    def _top(self) -> kdb.Cell:
        assert self.lv is not None
        return self.lv.cellview(self.cv).cell

    # -------------------------------------------------------------- 公開 API

    def info(self) -> dict:
        with self.lock:
            self._ensure()
            assert self.lv is not None
            ly = self.lv.cellview(self.cv).layout()
            b = self._top().bbox()
            layers = []
            for i, (it, node) in enumerate(self._nodes()):
                if i not in self._icons:
                    pb = self.lv.icon_for_layer(it, 28, 16, 2, 0, True)
                    self._icons[i] = base64.b64encode(pb.to_png_data()).decode()
                layers.append({
                    "id": i,
                    "name": node.name or f"{node.source_layer}/{node.source_datatype}",
                    "source": f"{node.source_layer}/{node.source_datatype}",
                    "fill": _hexcolor(node.eff_fill_color(True)),
                    "icon": self._icons[i],
                })
            return {
                "revision": self.revision,
                "file": self.path.name if self.path else "",
                "dbu": ly.dbu,
                "bbox": [b.left, b.bottom, b.right, b.top],
                "tile_px": TILE_PX,
                "background": BACKGROUND,
                "layers": layers,
            }

    def tile(self, level: int, ix: int, iy: int, mask: str | None) -> bytes:
        if not 0 <= level <= MAX_LEVEL:
            raise ValueError("level out of range")
        with self.lock:
            self._ensure()
            assert self.lv is not None
            key = (self.revision, level, ix, iy, mask)
            png = self.cache.get(key)
            if png is not None:
                self.cache.move_to_end(key)
                return png
            self._apply_mask(mask)
            dbu = self.lv.cellview(self.cv).layout().dbu
            w = TILE_PX * math.ldexp(1.0, level) * dbu  # µm
            box = kdb.DBox(ix * w, iy * w, (ix + 1) * w, (iy + 1) * w)
            png = self.lv.get_pixels_with_options(TILE_PX, TILE_PX, 1, 1, 0, box).to_png_data()
            self.cache[key] = png
            self.cache_bytes += len(png)
            while self.cache_bytes > CACHE_BYTES and self.cache:
                _, old = self.cache.popitem(last=False)
                self.cache_bytes -= len(old)
            return png

    def image(
        self,
        box_um: tuple[float, float, float, float] | None,
        width: int,
        height: int,
        mask: str | None,
    ) -> bytes:
        """box_um（省略時はチップ全体）を width × height の PNG 1 枚に描く（印刷・別タブ表示用）。"""
        width = max(16, min(int(width), MAX_IMAGE_PX))
        height = max(16, min(int(height), MAX_IMAGE_PX))
        with self.lock:
            self._ensure()
            assert self.lv is not None
            if box_um is None:
                bb = self._top().dbbox()
                pad = max(bb.width(), bb.height()) * 0.02
                bb = bb.enlarged(pad, pad)
            else:
                x0, y0, x1, y1 = box_um
                if not (x1 > x0 and y1 > y0):
                    raise ValueError("empty box")
                bb = kdb.DBox(x0, y0, x1, y1)
            self._apply_mask(mask)
            return self.lv.get_pixels_with_options(width, height, 1, 1, 0, bb).to_png_data()


RENDERER = LayoutRenderer()
