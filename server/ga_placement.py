"""ゲートアレイへの行優先配置（失敗時リトライ）。"""

from __future__ import annotations

import random
from dataclasses import dataclass

from server.ga_extract import GateSlot, PlacedGate, LayoutProblem


@dataclass
class PlacementPlan:
    placed: list[PlacedGate]
    row_usage: dict[int, list[int]]


def cell_bbox(cell: dict) -> tuple[float, float, float, float]:
    ox = float(cell["origin"]["x"])
    oy = float(cell["origin"]["y"])
    w = float(cell["size"]["width"])
    h = float(cell["size"]["height"])
    return ox, oy, ox + w, oy + h


def _cell_lookup(catalog: dict) -> dict[tuple[int, int], dict]:
    out: dict[tuple[int, int], dict] = {}
    for cell in catalog.get("cells", []):
        out[(int(cell["row"]), int(cell["col"]))] = cell
    return out


def _group_slots_by_component(slots: list[GateSlot]) -> list[tuple[str, list[GateSlot]]]:
    groups: dict[str, list[GateSlot]] = {}
    order: list[str] = []
    for slot in slots:
        if slot.component_ref not in groups:
            groups[slot.component_ref] = []
            order.append(slot.component_ref)
        groups[slot.component_ref].append(slot)
    for ref in groups:
        groups[ref].sort(key=lambda s: s.gate_index)
    return [(ref, groups[ref]) for ref in order]


def _find_contiguous_cols(
    row: int,
    length: int,
    cols: int,
    used: set[tuple[int, int]],
    *,
    reverse: bool = False,
    col_lo: int = 0,
) -> int | None:
    starts = range(col_lo, cols - length + 1)
    if reverse:
        starts = reversed(starts)
    for start in starts:
        ok = True
        for c in range(start, start + length):
            if (row, c) in used:
                ok = False
                break
        if ok:
            return start
    return None


def _try_place_group(
    group: list[GateSlot],
    used: set[tuple[int, int]],
    rows: int,
    cols: int,
    row_order: list[int],
    *,
    allow_split: bool,
    reverse_rows: frozenset[int] = frozenset(),
    col_lo: int = 0,
) -> list[PlacedGate] | None:
    n = len(group)
    for row in row_order:
        reverse = row in reverse_rows
        start = _find_contiguous_cols(
            row, n, cols, used, reverse=reverse, col_lo=col_lo
        )
        if start is not None:
            placed: list[PlacedGate] = []
            # 逆向き行（蛇行配置）ではゲート順も右→左にする
            order = list(reversed(group)) if reverse else group
            for i, slot in enumerate(order):
                col = start + i
                used.add((row, col))
                placed.append(
                    PlacedGate(
                        slot=slot,
                        row=row,
                        col=col,
                        cell_id=f"GA_R{row}_C{col}",
                    )
                )
            return placed

    if not allow_split or n < 2:
        return None

    # 一部を別行へ: 先頭 1 ゲートと残りを別行に分割
    for split in range(1, n):
        head = group[:split]
        tail = group[split:]
        trial_used = set(used)
        head_placed = _try_place_group(
            head,
            trial_used,
            rows,
            cols,
            row_order,
            allow_split=False,
            reverse_rows=reverse_rows,
            col_lo=col_lo,
        )
        if head_placed is None:
            continue
        tail_placed = _try_place_group(
            tail,
            trial_used,
            rows,
            cols,
            row_order,
            allow_split=True,
            reverse_rows=reverse_rows,
            col_lo=col_lo,
        )
        if tail_placed is not None:
            used.update(trial_used)
            return head_placed + tail_placed
    return None


def _component_nets(problem: LayoutProblem) -> dict[str, set[str]]:
    """component_ref → 接続する信号ネット集合（電源を除く）。"""
    out: dict[str, set[str]] = {}
    for net_key, eps in problem.net_groups.items():
        if net_key in ("g:VDD", "g:VSS", "g:0") or net_key.startswith("l:"):
            continue
        for ep in eps:
            out.setdefault(ep.component_ref, set()).add(net_key)
    return out


def _connectivity_order(
    groups: list[tuple[str, list[GateSlot]]],
    problem: LayoutProblem,
) -> list[tuple[str, list[GateSlot]]]:
    """接続の強い部品同士が隣り合うよう貪欲に並べる（信号の流れ順に近づける）。

    ネットリスト記述順と信号の流れが異なる回路で、配線長と行跨ぎネット数を減らす。
    """
    nets = _component_nets(problem)
    remaining = list(groups)
    if not remaining:
        return []
    ordered = [remaining.pop(0)]
    while remaining:
        last_nets = nets.get(ordered[-1][0], set())
        recent: set[str] = set()
        for ref, _ in ordered[-3:]:
            recent |= nets.get(ref, set())
        best_i = 0
        best_score = -1
        for i, (ref, _) in enumerate(remaining):
            mine = nets.get(ref, set())
            score = 4 * len(mine & last_nets) + len(mine & recent)
            if score > best_score:
                best_score = score
                best_i = i
        ordered.append(remaining.pop(best_i))
    return ordered


def place_gates_once(
    problem: LayoutProblem,
    catalog: dict,
    *,
    seed: int = 0,
    allow_split: bool = False,
) -> PlacementPlan | None:
    """1 回分の配置。

    - seed 0: ネットリスト記述順
    - seed 1: 接続関係に基づく順（隣接部品が強く結合するよう貪欲整列）
    - seed 2 以降: 部品順シャッフル + 開始行のずらし
    複数行に渡る場合は、行ごとの使用列数を均等化し、連続した行ブロックに
    蛇行（boustrophedon）配置する。行の折り返し点で隣り合う部品が
    上下に並ぶため、行跨ぎネットが短くなり行間ギャップの配線資源を浪費しない。
    """
    ga = catalog.get("gateArray", {})
    rows = int(ga.get("rows", 9))
    cols = int(ga.get("columnsPerRow", 35))
    groups = _group_slots_by_component(problem.gate_slots)
    # seed 0 はネットリスト出現順（U1→U2）。それ以降はコンポーネント順を
    # 並べ替えて配置候補を変える（信号の流れと物理順が食い違うと配線
    # チャネル容量的に不可能な配置になり得るため、リトライで探索する）。

    rng = random.Random(seed)
    if seed == 1:
        groups = _connectivity_order(groups, problem)
    elif seed > 1:
        rng.shuffle(groups)

    n_gates = sum(len(g) for _, g in groups)
    if n_gates > rows * cols:
        return None
    rows_needed = max(1, -(-n_gates // cols))
    # 行あたりの使用列数を均等化（最終行だけ詰め残すより行内配線が混雑しにくい）
    per_row = -(-n_gates // rows_needed) if rows_needed > 1 else cols
    if seed >= rows:
        # 行使用数の均等化で詰まる場合に備え、後半の試行は全列を使う
        per_row = cols
    if any(len(g) > per_row for _, g in groups):
        per_row = cols

    row_bias = 0 if seed < 2 else (seed % rows)
    start_row = min(row_bias, rows - rows_needed)
    block = list(range(start_row, start_row + rows_needed))
    rest = [r for r in range(rows) if r not in block]
    if seed >= rows:
        rng.shuffle(rest)
    row_order = block + rest
    # 蛇行: ブロック内の奇数番目の行は右→左
    reverse_rows = frozenset(r for i, r in enumerate(block) if i % 2 == 1)
    col_lo = 0  # 左寄せ（per_row は使用列の上限として扱う）

    used: set[tuple[int, int]] = set()
    # per_row を超える列は使用済み扱いにして行あたりの使用数を制限する
    if per_row < cols:
        for r in block:
            for c in range(per_row, cols):
                used.add((r, c))
    placed_all: list[PlacedGate] = []
    for _, group in groups:
        part = _try_place_group(
            group,
            used,
            rows,
            cols,
            row_order,
            allow_split=allow_split,
            reverse_rows=reverse_rows,
            col_lo=col_lo,
        )
        if part is None:
            return None
        placed_all.extend(part)

    row_usage: dict[int, list[int]] = {}
    for pg in placed_all:
        row_usage.setdefault(pg.row, []).append(pg.col)
    for r in row_usage:
        row_usage[r].sort()
    return PlacementPlan(placed=placed_all, row_usage=row_usage)


def place_gates(
    problem: LayoutProblem,
    catalog: dict,
    *,
    max_attempts: int = 72,
    seed: int = 0,
) -> PlacementPlan | None:
    ga = catalog.get("gateArray", {})
    rows = int(ga.get("rows", 9))
    for attempt in range(max_attempts):
        plan = place_gates_once(
            problem,
            catalog,
            seed=seed + attempt,
            allow_split=attempt >= rows,
        )
        if plan is not None:
            return plan
    return None


def resolve_pin_positions(
    placed: list[PlacedGate],
    catalog: dict,
) -> dict[tuple[str, str, str], tuple[float, float]]:
    """(component_ref, gate_instance, gate_pin) → (x, y) — ga_terminals へ委譲。"""
    from server.ga_terminals import resolve_pin_positions as _resolve

    return _resolve(placed, catalog)
