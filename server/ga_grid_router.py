"""10 µm セル塗りつぶし式 METAL5 配線ルーター。

設計方針:
- base.gds と同サイズの 10 µm 格子を用意し、METAL5 が存在するセルを
  障害物として塗りつぶす。格子原点は bbox 原点（セル中心 = 10i+5）で、
  ゲートの各ピンパッド（5 µm 角、中心が 10 の倍数 + 5）がセル中心に一致する。
- 配線はセル単位の塗りつぶし（A*）。塗りつぶしたセルはそのネットの占有と
  なり、以降のネットは通れない。逐次確定なので配線同士は決して交差しない。
- 端子ピンは同一 X 列上の全 routingTracks 段のパッドを接続先候補にできる。
- 配線後、塗りつぶしセルの中心を通る 5 µm 幅の GDS 配線を生成する。
  セルピッチ 10 µm・配線幅 5 µm なので、隣接セル同士でも辺間 5 µm が保たれる。
- デバッグ用に塗りつぶし状態をビットマップ (PNG) として保存できる。
"""

from __future__ import annotations

import heapq
from collections import defaultdict
from pathlib import Path

from server.ga_router import WireSegment

CELL_UM = 10.0
# 探索窓: 端点外接矩形の外側マージン [セル]
SEARCH_WINDOW_MARGIN = 40
WIRE_WIDTH_UM = 5.0

Cell = tuple[int, int]

# ビットマップ配色
_COLOR_FREE = (255, 255, 255)
_COLOR_OBSTACLE = (200, 200, 200)
_COLOR_PAD_FREE = (120, 120, 120)
_NET_PALETTE = [
    (214, 39, 40),
    (31, 119, 180),
    (44, 160, 44),
    (255, 127, 14),
    (148, 103, 189),
    (140, 86, 75),
    (227, 119, 194),
    (23, 190, 207),
    (188, 189, 34),
    (127, 60, 141),
]
_COLOR_VDD = (255, 180, 180)
_COLOR_VSS = (180, 180, 255)


class PaintGrid:
    """10 µm セルの塗りつぶしグリッド。"""

    def __init__(
        self,
        bbox: tuple[float, float, float, float],
        obstacle_boxes: list[tuple[float, float, float, float]],
        *,
        pitch: float = CELL_UM,
    ) -> None:
        self.bbox = bbox
        self.pitch = pitch
        self.x0, self.y0 = bbox[0], bbox[1]
        self.nx = max(1, int(round((bbox[2] - bbox[0]) / pitch)))
        self.ny = max(1, int(round((bbox[3] - bbox[1]) / pitch)))
        self._obstacles: set[Cell] = set()
        self._painted: dict[Cell, str] = {}
        self._pads: dict[Cell, str] = {}
        self._jumpers: dict[Cell, set[Cell]] = defaultdict(set)
        # 塗りつぶし変更履歴（checkpoint / rollback 用）: (cell, 変更前 owner)
        self._paint_log: list[tuple[Cell, str | None]] = []
        # 水平移動ペナルティ（gy → 追加コスト）。行間の端子アクセス行・
        # ジャンパで跨げない行を水平配線で塞がないよう誘導する。
        self._h_penalty: dict[int, float] = {}
        self._global_nets: set[str] = set()
        self._row_crossing_ys: frozenset[float] = frozenset()
        self._ga_row_bands: tuple[tuple[float, float], ...] = ()
        self._rasterize_obstacles(obstacle_boxes)

    # --- 座標変換 ---

    def cell_of(self, x: float, y: float) -> Cell:
        return (
            int((x - self.x0) // self.pitch),
            int((y - self.y0) // self.pitch),
        )

    def center_of(self, cell: Cell) -> tuple[float, float]:
        return (
            self.x0 + cell[0] * self.pitch + self.pitch / 2.0,
            self.y0 + cell[1] * self.pitch + self.pitch / 2.0,
        )

    def in_bounds(self, cell: Cell) -> bool:
        return 0 <= cell[0] < self.nx and 0 <= cell[1] < self.ny

    # --- 障害物・パッド ---

    def _rasterize_obstacles(
        self,
        boxes: list[tuple[float, float, float, float]],
        eps: float = 1e-6,
    ) -> None:
        for bx0, by0, bx1, by1 in boxes:
            ix0 = max(0, int((bx0 - self.x0 + eps) // self.pitch))
            iy0 = max(0, int((by0 - self.y0 + eps) // self.pitch))
            ix1 = min(self.nx - 1, int((bx1 - self.x0 - eps) // self.pitch))
            iy1 = min(self.ny - 1, int((by1 - self.y0 - eps) // self.pitch))
            for ix in range(ix0, ix1 + 1):
                for iy in range(iy0, iy1 + 1):
                    self._obstacles.add((ix, iy))

    def register_pad(self, x: float, y: float, net_key: str) -> Cell:
        """ピンパッド（セル中心にある 5 µm 角 METAL5）をネットに割り当てる。"""
        cell = self.cell_of(x, y)
        self._pads[cell] = net_key
        return cell

    def register_jumper(self, c1: Cell, c2: Cell) -> None:
        """低層メタルジャンパ（METAL5 では描画しないテレポートエッジ）。

        ジャンパ両端は base.gds の METAL5 パッド（障害物セル）だが、未使用なら
        どのネットも占有できる。片端に触れた時点で M4 経由で反対端も同電位に
        なるため、paint() は常に両端をまとめて占有する。
        """
        if c1 == c2:
            return
        if not (self.in_bounds(c1) and self.in_bounds(c2)):
            return
        self._jumpers[c1].add(c2)
        self._jumpers[c2].add(c1)

    def is_jumper_pad(self, cell: Cell) -> bool:
        return cell in self._jumpers

    def jumper_partners(self, cell: Cell) -> set[Cell]:
        return set(self._jumpers.get(cell, ()))

    def with_jumper_partners(self, cells) -> set[Cell]:
        """セル集合に、含まれるジャンパパッドの反対端を加えた集合。"""
        out = set(cells)
        for c in list(out):
            out |= self._jumpers.get(c, set())
        return out

    def set_horizontal_penalties(self, penalties: dict[int, float]) -> None:
        self._h_penalty = dict(penalties)

    # --- 変更履歴（トランザクション） ---

    def checkpoint(self) -> int:
        """現在の塗りつぶし状態のマーク。rollback(mark) で戻せる。"""
        return len(self._paint_log)

    def rollback(self, mark: int) -> None:
        """checkpoint 以降の塗りつぶしを取り消す（失敗した配線試行の残骸を消す）。"""
        log = self._paint_log
        while len(log) > mark:
            cell, prev = log.pop()
            if prev is None:
                self._painted.pop(cell, None)
            else:
                self._painted[cell] = prev

    def _set_owner(self, cell: Cell, net_key: str) -> None:
        prev = self._painted.get(cell)
        if prev == net_key:
            return
        self._paint_log.append((cell, prev))
        self._painted[cell] = net_key

    def set_global_routing_context(
        self,
        row_crossing_ys: frozenset[float],
        *,
        row_bands: tuple[tuple[float, float], ...] = (),
    ) -> None:
        self._row_crossing_ys = row_crossing_ys
        self._ga_row_bands = row_bands

    def set_global_nets(self, global_nets: set[str]) -> None:
        self._global_nets = set(global_nets)

    def row_band_bounds(
        self,
        y: float,
        x_lo: float,
        x_hi: float,
        *,
        margin_cells: int = 20,
    ) -> tuple[int, int, int, int] | None:
        """y を含む GA 行帯（VDD/VSS バス間）の探索矩形 [セル]。"""
        for y_lo, y_hi in self._ga_row_bands:
            if y_lo - 1e-6 <= y <= y_hi + 1e-6:
                gy0 = self.cell_of(0.0, y_lo)[1]
                gy1 = self.cell_of(0.0, y_hi)[1]
                gx0 = max(0, self.cell_of(x_lo, 0.0)[0] - margin_cells)
                gx1 = min(self.nx - 1, self.cell_of(x_hi, 0.0)[0] + margin_cells)
                return (gx0, gy0, gx1, gy1)
        return None

    def is_jumper_pair(self, c1: Cell, c2: Cell) -> bool:
        return c2 in self._jumpers.get(c1, ())

    def _near_row_crossing_y(self, y: float, *, eps: float = 2.0) -> bool:
        return any(abs(y - cy) <= eps for cy in self._row_crossing_ys)

    def _in_same_ga_row_band(self, y0: float, y1: float) -> bool:
        """同一 GA 行セル内（行間ギャップを除く）なら True。"""
        for y_lo, y_hi in self._ga_row_bands:
            if y_lo - 1e-6 <= y0 <= y_hi + 1e-6 and y_lo - 1e-6 <= y1 <= y_hi + 1e-6:
                return True
        return False

    def _vertical_step_allowed(
        self,
        c0: Cell,
        c1: Cell,
        net_key: str,
        *,
        extra_vertical_gys: frozenset[int] | None = None,
        intra_cell_routing: bool = False,
    ) -> bool:
        """グローバル信号の垂直移動制約。

        - 行内: routingTracks / rowCrossingY 間を自由に垂直移動可（水平配線用）。
          VDD/VSS 占有セルは passable() で除外される。
        - 行間: ジャンパ列 METAL5 / 低層ジャンパ / extra_vertical_gys のみ。
        """
        if intra_cell_routing:
            return True
        if net_key not in self._global_nets:
            return True
        if self.is_jumper_pair(c0, c1):
            return True
        if extra_vertical_gys and c0[1] in extra_vertical_gys and c1[1] in extra_vertical_gys:
            return True
        y0 = self.center_of(c0)[1]
        y1 = self.center_of(c1)[1]
        if self._in_same_ga_row_band(y0, y1):
            return True
        return self._near_row_crossing_y(y0) and self._near_row_crossing_y(y1)

    # --- 通行判定 ---

    def passable(self, cell: Cell, net_key: str) -> bool:
        if not self.in_bounds(cell):
            return False
        owner = self._painted.get(cell)
        if owner is not None:
            return owner == net_key
        pad = self._pads.get(cell)
        if pad is not None:
            return pad == net_key
        partners = self._jumpers.get(cell)
        if partners:
            # 未使用ジャンパ: 反対端が他ネットに占有されていなければ使える
            return all(
                self._painted.get(p) in (None, net_key)
                and self._pads.get(p) in (None, net_key)
                for p in partners
            )
        return cell not in self._obstacles

    def painted_cells(self, net_key: str) -> set[Cell]:
        return {c for c, owner in self._painted.items() if owner == net_key}

    def paint(self, cells: list[Cell] | set[Cell], net_key: str) -> None:
        for cell in cells:
            self._set_owner(cell, net_key)
            # ジャンパパッドに触れたら反対端（M4 で導通）も同ネットが占有
            for partner in self._jumpers.get(cell, ()):
                self._set_owner(partner, net_key)

    def rasterize_segments(
        self,
        segments: list[WireSegment],
        eps: float = 1e-6,
    ) -> None:
        """既定配線（電源など）をネット占有としてグリッドに焼き込む。"""
        for seg in segments:
            hw = seg.width_um / 2.0
            bx0 = min(seg.x0, seg.x1) - hw
            bx1 = max(seg.x0, seg.x1) + hw
            by0 = min(seg.y0, seg.y1) - hw
            by1 = max(seg.y0, seg.y1) + hw
            ix0 = max(0, int((bx0 - self.x0 + eps) // self.pitch))
            iy0 = max(0, int((by0 - self.y0 + eps) // self.pitch))
            ix1 = min(self.nx - 1, int((bx1 - self.x0 - eps) // self.pitch))
            iy1 = min(self.ny - 1, int((by1 - self.y0 - eps) // self.pitch))
            cells = [
                (ix, iy)
                for ix in range(ix0, ix1 + 1)
                for iy in range(iy0, iy1 + 1)
            ]
            self.paint(cells, seg.net_key)

    # --- 経路探索 ---

    def route(
        self,
        net_key: str,
        starts: set[Cell],
        goals: set[Cell],
        *,
        extra_vertical_gys: frozenset[int] | None = None,
        intra_cell_routing: bool = False,
        obstacle_goals: set[Cell] | None = None,
        bounds: tuple[int, int, int, int] | None = None,
    ) -> tuple[list[Cell], set[frozenset[Cell]]] | None:
        """starts から goals への 4 近傍 + ジャンパ A*。

        bounds=(gx_lo, gy_lo, gx_hi, gy_hi) を渡すとその矩形内だけを探索する
        （行内配線用。行の両端はチップ外周マージンに開いているため、
        到達不能な行内探索がチップ全域を総なめにしないようにする）。

        返値: (セル列, ジャンパエッジ集合)。ジャンパ間は METAL5 を引かない。
        """
        obstacle_goals = obstacle_goals or set()
        starts = {c for c in starts if self.passable(c, net_key)}
        goals = {
            c
            for c in goals
            if self.passable(c, net_key) or c in obstacle_goals
        }
        if bounds is not None:
            bx0, by0, bx1, by1 = bounds
            starts = {c for c in starts if bx0 <= c[0] <= bx1 and by0 <= c[1] <= by1}
            goals = {c for c in goals if bx0 <= c[0] <= bx1 and by0 <= c[1] <= by1}
        if not starts or not goals:
            return None
        if starts & goals:
            return [], set()
        if bounds is not None:
            found = self._astar(
                net_key,
                starts,
                goals,
                bounds,
                extra_vertical_gys=extra_vertical_gys,
                intra_cell_routing=intra_cell_routing,
                obstacle_goals=obstacle_goals,
            )
            if found is None:
                return None
            return self._trace(*found)

        # まず端点の外接矩形 + マージン内で探索し、見つからなければ全域。
        # 到達不能な探索がチップ全域を総なめにするコストを抑える。
        xs = [c[0] for c in starts] + [c[0] for c in goals]
        ys = [c[1] for c in starts] + [c[1] for c in goals]
        window = (
            min(xs) - SEARCH_WINDOW_MARGIN,
            min(ys) - SEARCH_WINDOW_MARGIN,
            max(xs) + SEARCH_WINDOW_MARGIN,
            max(ys) + SEARCH_WINDOW_MARGIN,
        )
        window_area = (window[2] - window[0] + 1) * (window[3] - window[1] + 1)
        covers_all = (
            window[0] <= 0
            and window[1] <= 0
            and window[2] >= self.nx - 1
            and window[3] >= self.ny - 1
        )
        found = None
        if not covers_all and window_area < 0.5 * self.nx * self.ny:
            found = self._astar(
                net_key,
                starts,
                goals,
                window,
                extra_vertical_gys=extra_vertical_gys,
                intra_cell_routing=intra_cell_routing,
                obstacle_goals=obstacle_goals,
            )
            if found is not None:
                return self._trace(*found)
        # 全域探索。到達不能なら A* を走らせる前に塗りつぶし探索で即判定する。
        if not self._reachable(
            net_key,
            starts,
            goals,
            extra_vertical_gys=extra_vertical_gys,
            intra_cell_routing=intra_cell_routing,
            obstacle_goals=obstacle_goals,
        ):
            return None
        found = self._astar(
            net_key,
            starts,
            goals,
            None,
            extra_vertical_gys=extra_vertical_gys,
            intra_cell_routing=intra_cell_routing,
            obstacle_goals=obstacle_goals,
        )
        if found is None:
            return None
        return self._trace(*found)

    @staticmethod
    def _trace(goal_cell, came, via_jumper):
        path: list[Cell] = []
        jumper_edges: set[frozenset[Cell]] = set()
        cur: Cell | None = goal_cell
        while cur is not None:
            path.append(cur)
            prev = came[cur]
            if prev is not None and via_jumper.get(cur, False):
                jumper_edges.add(frozenset({prev, cur}))
            cur = prev
        path.reverse()
        return path, jumper_edges

    def _astar(
        self,
        net_key: str,
        starts: set[Cell],
        goals: set[Cell],
        window: tuple[int, int, int, int] | None,
        *,
        extra_vertical_gys: frozenset[int] | None,
        intra_cell_routing: bool,
        obstacle_goals: set[Cell],
    ):
        """4 近傍 + ジャンパ A* 本体。(goal_state, came, via_jumper) を返す。"""
        # ヒューリスティック: ゴール集合の外接矩形までのマンハッタン距離
        # （全ゴールとの最小距離を毎回計算すると大きな島で O(|goals|) になる）
        gx_lo = min(c[0] for c in goals)
        gx_hi = max(c[0] for c in goals)
        gy_lo = min(c[1] for c in goals)
        gy_hi = max(c[1] for c in goals)

        def h(cell: Cell) -> float:
            x, y = cell
            dx = gx_lo - x if x < gx_lo else (x - gx_hi if x > gx_hi else 0)
            dy = gy_lo - y if y < gy_lo else (y - gy_hi if y > gy_hi else 0)
            return float(dx + dy)

        if window is not None:
            wx0, wy0, wx1, wy1 = window

            def in_window(c: Cell) -> bool:
                return wx0 <= c[0] <= wx1 and wy0 <= c[1] <= wy1
        else:

            def in_window(c: Cell) -> bool:
                return True

        turn_cost = 0.05
        jumper_cost = 0.02
        h_penalty = self._h_penalty
        jumpers = self._jumpers
        passable = self.passable
        vertical_ok = self._vertical_step_allowed
        unconstrained = intra_cell_routing or net_key not in self._global_nets
        # 状態はセルのみ（進入方向は came_dir に保持して曲がりコストに使う）。
        # 方向を状態に含めると探索空間が 5 倍になり、到達不能時に極端に遅い。
        counter = 0
        open_heap: list[tuple[float, int, float, Cell]] = []
        g_score: dict[Cell, float] = {}
        came: dict[Cell, Cell | None] = {}
        came_dir: dict[Cell, int] = {}
        via_jumper: dict[Cell, bool] = {}
        for c in starts:
            g_score[c] = 0.0
            came[c] = None
            came_dir[c] = -1
            via_jumper[c] = False
            heapq.heappush(open_heap, (h(c), counter, 0.0, c))
            counter += 1

        dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
        inf = float("inf")
        while open_heap:
            _, _, g_at_push, cell = heapq.heappop(open_heap)
            base_g = g_score[cell]
            if g_at_push > base_g + 1e-9:
                continue  # より良い経路で更新済みの古いエントリ
            if cell in goals:
                return cell, came, via_jumper
            d = came_dir[cell]
            cx, cy = cell
            for nd, (dx, dy) in enumerate(dirs):
                nb = (cx + dx, cy + dy)
                if not in_window(nb):
                    continue
                if not passable(nb, net_key) and nb not in obstacle_goals:
                    continue
                if dy != 0 and not unconstrained and not vertical_ok(
                    cell,
                    nb,
                    net_key,
                    extra_vertical_gys=extra_vertical_gys,
                    intra_cell_routing=intra_cell_routing,
                ):
                    continue
                cost = 1.0 + (turn_cost if d != -1 and nd != d else 0.0)
                if dy == 0:
                    cost += h_penalty.get(nb[1], 0.0)
                ng = base_g + cost
                if ng < g_score.get(nb, inf):
                    g_score[nb] = ng
                    came[nb] = cell
                    came_dir[nb] = nd
                    via_jumper[nb] = False
                    heapq.heappush(open_heap, (ng + h(nb), counter, ng, nb))
                    counter += 1
            for partner in jumpers.get(cell, ()):
                if not in_window(partner):
                    continue
                if not passable(partner, net_key) and partner not in goals:
                    continue
                ng = base_g + jumper_cost
                if ng < g_score.get(partner, inf):
                    g_score[partner] = ng
                    came[partner] = cell
                    came_dir[partner] = -1
                    via_jumper[partner] = True
                    heapq.heappush(
                        open_heap, (ng + h(partner), counter, ng, partner)
                    )
                    counter += 1
        return None

    def _reachable(
        self,
        net_key: str,
        starts: set[Cell],
        goals: set[Cell],
        *,
        extra_vertical_gys: frozenset[int] | None,
        intra_cell_routing: bool,
        obstacle_goals: set[Cell],
    ) -> bool:
        """コスト無しの塗りつぶし探索で到達可能性だけを判定する（A* より数倍速い）。"""
        from collections import deque

        passable = self.passable
        unconstrained = intra_cell_routing or net_key not in self._global_nets
        seen = set(starts)
        queue = deque(starts)
        while queue:
            cell = queue.popleft()
            if cell in goals:
                return True
            cx, cy = cell
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nb = (cx + dx, cy + dy)
                if nb in seen:
                    continue
                if not passable(nb, net_key) and nb not in obstacle_goals:
                    continue
                if dy != 0 and not unconstrained and not self._vertical_step_allowed(
                    cell,
                    nb,
                    net_key,
                    extra_vertical_gys=extra_vertical_gys,
                    intra_cell_routing=intra_cell_routing,
                ):
                    continue
                seen.add(nb)
                queue.append(nb)
            for partner in self._jumpers.get(cell, ()):
                if partner in seen:
                    continue
                if not passable(partner, net_key) and partner not in goals:
                    continue
                seen.add(partner)
                queue.append(partner)
        return False

    def _in_bounds_box(
        self,
        cell: Cell,
        gx_lo: int,
        gx_hi: int,
        gy_lo: int,
        gy_hi: int,
    ) -> bool:
        return (
            gx_lo <= cell[0] <= gx_hi
            and gy_lo <= cell[1] <= gy_hi
            and self.in_bounds(cell)
        )

    def route_bounded(
        self,
        net_key: str,
        starts: set[Cell],
        goals: set[Cell],
        *,
        gx_lo: int,
        gx_hi: int,
        gy_lo: int,
        gy_hi: int,
        obstacle_goals: set[Cell] | None = None,
        intra_cell_routing: bool = False,
    ) -> tuple[list[Cell], set[frozenset[Cell]]] | None:
        """矩形内 A* — サイト内 METAL5 / 行間ジャンパ列の垂直配線用。"""
        obstacle_goals = obstacle_goals or set()
        starts = {
            c
            for c in starts
            if self._in_bounds_box(c, gx_lo, gx_hi, gy_lo, gy_hi)
            and self.passable(c, net_key)
        }
        goals = {
            c
            for c in goals
            if self._in_bounds_box(c, gx_lo, gx_hi, gy_lo, gy_hi)
            and (self.passable(c, net_key) or c in obstacle_goals)
        }
        if not starts or not goals:
            return None
        if starts & goals:
            return [], set()

        dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
        hx_lo = min(c[0] for c in goals)
        hx_hi = max(c[0] for c in goals)
        hy_lo = min(c[1] for c in goals)
        hy_hi = max(c[1] for c in goals)

        def h(cell: Cell) -> float:
            x, y = cell
            dx = hx_lo - x if x < hx_lo else (x - hx_hi if x > hx_hi else 0)
            dy = hy_lo - y if y < hy_lo else (y - hy_hi if y > hy_hi else 0)
            return float(dx + dy)

        counter = 0
        open_heap: list[tuple[float, int, Cell]] = []
        g_score: dict[Cell, float] = {c: 0.0 for c in starts}
        came: dict[Cell, Cell | None] = {c: None for c in starts}
        for c in starts:
            heapq.heappush(open_heap, (h(c), counter, c))
            counter += 1

        goal_cell: Cell | None = None
        while open_heap:
            _, _, cell = heapq.heappop(open_heap)
            if cell in goals:
                goal_cell = cell
                break
            base_g = g_score[cell]
            for dx, dy in dirs:
                nb = (cell[0] + dx, cell[1] + dy)
                if not self._in_bounds_box(nb, gx_lo, gx_hi, gy_lo, gy_hi):
                    continue
                if not self.passable(nb, net_key) and nb not in obstacle_goals:
                    continue
                if (
                    dy != 0
                    and not intra_cell_routing
                    and not self.is_jumper_pair(cell, nb)
                ):
                    continue
                ng = base_g + 1.0
                if ng < g_score.get(nb, float("inf")):
                    g_score[nb] = ng
                    came[nb] = cell
                    heapq.heappush(open_heap, (ng + h(nb), counter, nb))
                    counter += 1
            for partner in self._jumpers.get(cell, ()):
                if not self._in_bounds_box(
                    partner, gx_lo, gx_hi, gy_lo, gy_hi
                ):
                    continue
                if not self.passable(partner, net_key) and partner not in goals:
                    continue
                ng = base_g + 0.02
                if ng < g_score.get(partner, float("inf")):
                    g_score[partner] = ng
                    came[partner] = cell
                    heapq.heappush(open_heap, (ng + h(partner), counter, partner))
                    counter += 1

        if goal_cell is None:
            return None
        path: list[Cell] = []
        jumper_edges: set[frozenset[Cell]] = set()
        cur: Cell | None = goal_cell
        while cur is not None:
            path.append(cur)
            prev = came.get(cur)
            if prev is not None and self.is_jumper_pair(prev, cur):
                jumper_edges.add(frozenset({prev, cur}))
            cur = prev
        path.reverse()
        return path, jumper_edges

    def route_bounded_and_paint(
        self,
        net_key: str,
        starts: set[Cell],
        goals: set[Cell],
        *,
        gx_lo: int,
        gx_hi: int,
        gy_lo: int,
        gy_hi: int,
        path_id: int,
        obstacle_goals: set[Cell] | None = None,
        intra_cell_routing: bool = False,
    ) -> tuple[list[WireSegment], list[Cell]] | None:
        """矩形内 METAL5 配線 — 障害物セル上のゴールも許可。"""
        routed = self.route_bounded(
            net_key,
            starts,
            goals,
            gx_lo=gx_lo,
            gx_hi=gx_hi,
            gy_lo=gy_lo,
            gy_hi=gy_hi,
            obstacle_goals=obstacle_goals,
            intra_cell_routing=intra_cell_routing,
        )
        if routed is None:
            return None
        path, jumper_edges = routed
        if len(path) < 2:
            if path:
                self.paint(path, net_key)
            return [], path
        self.paint(path, net_key)
        return (
            path_to_segments(self, path, net_key, path_id, jumper_edges),
            path,
        )

    def route_and_paint(
        self,
        net_key: str,
        starts: set[Cell],
        goals: set[Cell],
        *,
        path_id: int,
        extra_vertical_gys: frozenset[int] | None = None,
        intra_cell_routing: bool = False,
        obstacle_goals: set[Cell] | None = None,
        bounds: tuple[int, int, int, int] | None = None,
    ) -> tuple[list[WireSegment], list[Cell]] | None:
        """経路を探索して塗りつぶし、(セグメント列, 経路セル列) を返す。"""
        routed = self.route(
            net_key,
            starts,
            goals,
            extra_vertical_gys=extra_vertical_gys,
            intra_cell_routing=intra_cell_routing,
            obstacle_goals=obstacle_goals,
            bounds=bounds,
        )
        if routed is None:
            return None
        path, jumper_edges = routed
        if len(path) < 2:
            return [], []
        self.paint(path, net_key)
        return (
            path_to_segments(self, path, net_key, path_id, jumper_edges),
            path,
        )

    # --- デバッグビットマップ ---

    def save_bitmap(self, out_path: Path, *, scale: int = 2) -> None:
        from PIL import Image

        net_colors: dict[str, tuple[int, int, int]] = {}

        def color_for(net_key: str) -> tuple[int, int, int]:
            if net_key == "g:VDD":
                return _COLOR_VDD
            if net_key in ("g:VSS", "g:0"):
                return _COLOR_VSS
            if net_key not in net_colors:
                net_colors[net_key] = _NET_PALETTE[
                    len(net_colors) % len(_NET_PALETTE)
                ]
            return net_colors[net_key]

        img = Image.new("RGB", (self.nx, self.ny), _COLOR_FREE)
        px = img.load()
        for (ix, iy) in self._obstacles:
            px[ix, self.ny - 1 - iy] = _COLOR_OBSTACLE
        for cell, net_key in self._pads.items():
            px[cell[0], self.ny - 1 - cell[1]] = _COLOR_PAD_FREE
        for cell, net_key in self._painted.items():
            px[cell[0], self.ny - 1 - cell[1]] = color_for(net_key)
        if scale != 1:
            img = img.resize(
                (self.nx * scale, self.ny * scale), Image.NEAREST
            )
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path)


def path_to_segments(
    grid: PaintGrid,
    path: list[Cell],
    net_key: str,
    path_id: int,
    jumper_edges: set[frozenset[Cell]] | None = None,
) -> list[WireSegment]:
    """セル列をセル中心を通る 5 µm 幅の直交セグメント列へ変換する。

    ジャンパエッジ間は METAL5 セグメントを生成しない（低層メタル導通）。
    """
    if len(path) < 2:
        return []
    jumpers = jumper_edges or set()
    points = [grid.center_of(c) for c in path]
    compressed = [points[0]]
    for i in range(1, len(points) - 1):
        (ax, ay), (bx, by), (cx, cy) = compressed[-1], points[i], points[i + 1]
        if (abs(ax - bx) < 1e-6 and abs(bx - cx) < 1e-6) or (
            abs(ay - by) < 1e-6 and abs(by - cy) < 1e-6
        ):
            continue
        compressed.append((bx, by))
    compressed.append(points[-1])
    segments: list[WireSegment] = []
    for i in range(len(path) - 1):
        if frozenset({path[i], path[i + 1]}) in jumpers:
            continue
        (ax, ay), (bx, by) = grid.center_of(path[i]), grid.center_of(path[i + 1])
        if abs(ax - bx) < 1e-6 and abs(ay - by) < 1e-6:
            continue
        segments.append(
            WireSegment(ax, ay, bx, by, WIRE_WIDTH_UM, net_key, path_id)
        )
    return segments
