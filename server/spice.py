"""サーバ側 SPICE 実行（ngspice バッチモード）。

undine-eda の simulation/sim.py と同じ方式:
- ngspice を探す（$AGILEX_NGSPICE → $UNDINE_TOOLS/bin → 実行中 Python 環境の bin
  → ~/undine-tools/bin → PATH）
- 実行ごとの作業ディレクトリに netlist.cir を書き、
  ``ngspice -b -o log.txt -r out.raw netlist.cir`` で実行
- .control ブロックがある場合は -r を付けず（ブロック内の write が raw を書く）、
  末尾に quit を補う。.meas は -r 指定時に評価されないため .control で包む
- raw ファイル（binary / ascii）を解析し、フロントエンドが従来使っていた
  eecircuit-engine の ResultType と同じ形の JSON を返す
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

DEFAULT_TIMEOUT_S = float(os.environ.get("AGILEX_SIM_TIMEOUT", "120"))
# 返す波形の最大点数。超える場合は区間ごとの最小・最大点を残して間引く
# （細いスパイクを落とさない）。描画は画面解像度なので表示上の差はない。
DEFAULT_MAX_POINTS = int(os.environ.get("AGILEX_SIM_MAX_POINTS", "8000"))
MAX_NETLIST_BYTES = 2_000_000

_CONTROL_RE = re.compile(r"^\s*\.control\b.*?^\s*\.endc\b[^\n]*\n?", re.M | re.I | re.S)
_MEAS_RE = re.compile(r"^\s*\.meas(ure)?\b", re.M | re.I)
_END_RE = re.compile(r"^\s*\.end\s*$", re.M | re.I)
# .control 内で外部コマンドを起動できるコマンドは受け付けない
_FORBIDDEN_CONTROL_RE = re.compile(r"^\s*(shell|exec|system)\b", re.M | re.I)
MEAS_CONTROL = ".control\nrun\nwrite out.raw\nquit\n.endc\n"


class SimulationError(RuntimeError):
    """ngspice が見つからないなど、実行前に判明するエラー。"""


class NetlistRejected(SimulationError):
    """受け付けられないネットリスト（大きすぎる・外部コマンド実行を含む）。"""


# ------------------------------------------------------------------ ngspice の検出


def _candidate_dirs() -> list[Path]:
    dirs: list[Path] = []
    if os.environ.get("UNDINE_TOOLS"):
        dirs.append(Path(os.environ["UNDINE_TOOLS"]).expanduser() / "bin")
    dirs.append(Path(sys.prefix) / "bin")
    dirs.append(Path.home() / "undine-tools" / "bin")
    return dirs


def find_ngspice() -> str | None:
    explicit = os.environ.get("AGILEX_NGSPICE")
    if explicit:
        p = Path(explicit).expanduser()
        return str(p) if p.is_file() and os.access(p, os.X_OK) else None
    for d in _candidate_dirs():
        p = d / "ngspice"
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    return shutil.which("ngspice")


@lru_cache(maxsize=4)
def _version(path: str) -> str:
    try:
        out = subprocess.run(
            [path, "-v"],
            capture_output=True,
            text=True,
            timeout=10,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    m = re.search(r"ngspice-\S+", out.stdout + out.stderr)
    return m.group(0) if m else ""


def simulator_status() -> dict:
    path = find_ngspice()
    if path is None:
        return {
            "available": False,
            "simulator": "ngspice",
            "detail": (
                "ngspice not found. Install it (e.g. `sudo apt install ngspice` or "
                "`conda install -c conda-forge ngspice`) or set AGILEX_NGSPICE / UNDINE_TOOLS."
            ),
        }
    return {
        "available": True,
        "simulator": "ngspice",
        "path": path,
        "version": _version(path),
    }


# ------------------------------------------------------------------ ネットリスト前処理


def _before_end(text: str, card: str) -> str:
    """card を .end の直前に挿入する（.end が無ければ末尾に .end を付ける）。"""
    m = None
    for m in _END_RE.finditer(text):
        pass
    if m is None:
        return text.rstrip("\n") + "\n" + card + ".end\n"
    return text[: m.start()] + card + text[m.start():]


def _quit_after_control(text: str) -> str:
    """.control ブロックの末尾に quit が無ければ補う（無いと対話待ちで止まる）。"""

    def fix(m: re.Match) -> str:
        block = m.group(0)
        if re.search(r"^\s*(quit|exit)\b", block, re.M | re.I):
            return block
        return re.sub(r"^(\s*\.endc\b)", r"quit\n\1", block, count=1, flags=re.M | re.I)

    return _CONTROL_RE.sub(fix, text)


def prepare_netlist(netlist: str) -> tuple[str, bool]:
    """(実行するネットリスト, -r out.raw を使うか)。"""
    if len(netlist.encode("utf-8", "replace")) > MAX_NETLIST_BYTES:
        raise NetlistRejected("netlist is too large")
    text = netlist.replace("\r\n", "\n")
    if not text.endswith("\n"):
        text += "\n"
    controls = _CONTROL_RE.findall(text)
    if any(_FORBIDDEN_CONTROL_RE.search(block) for block in controls):
        raise NetlistRejected(".control blocks may not run external commands (shell/exec)")
    if controls:
        return _quit_after_control(text), False
    if _MEAS_RE.search(text):
        # バッチモード + -r では .meas が評価されないため、.control から実行して raw を書く
        return _before_end(text, MEAS_CONTROL), False
    return text, True


# ------------------------------------------------------------------ raw ファイル


def _raw_head(f) -> tuple[bytes, int, str]:
    head = b""
    while not (m := re.search(rb"^(Binary|Values):[^\n]*\n", head, re.M)):
        chunk = f.read(1 << 16)
        if not chunk:
            raise ValueError("not an ngspice raw file (no Binary: or Values: line)")
        head += chunk
    return head[: m.end()], m.end(), m.group(1).decode()


def _parse_header(head: bytes) -> tuple[dict, list[tuple[str, str]]]:
    hdr: dict[str, str] = {}
    variables: list[tuple[str, str]] = []
    lines = iter(head.decode("latin-1").split("\n"))
    for line in lines:
        if line.startswith("Variables:"):
            for _ in range(int(hdr["No. Variables"])):
                parts = next(lines).split()
                variables.append((parts[1], parts[2]))
        elif line.startswith(("Binary:", "Values:")):
            break
        elif ":" in line:
            k, v = line.split(":", 1)
            hdr[k.strip()] = v.strip()
    return hdr, variables


def read_raw_plots(path: Path) -> list[dict]:
    """raw ファイル内の全プロット（.op → .tran のように複数並ぶことがある）。"""
    data = path.read_bytes()
    plots: list[dict] = []
    pos = 0
    while pos < len(data):
        rest = data[pos:]
        if not rest.strip():
            break
        m = re.search(rb"^(Binary|Values):[^\n]*\n", rest, re.M)
        if m is None:
            break
        head = rest[: m.end()]
        hdr, variables = _parse_header(head)
        nvar = int(hdr["No. Variables"])
        npts = int(hdr["No. Points"])
        cplx = "complex" in hdr.get("Flags", "").lower()
        width = 2 if cplx else 1
        body_start = pos + m.end()
        if m.group(1) == b"Binary":
            count = npts * nvar * width
            arr = np.frombuffer(data, dtype="<f8", count=count, offset=body_start)
            arr = arr.reshape(npts, nvar * width)
            pos = body_start + count * 8
        else:
            text = data[body_start:].decode("latin-1")
            toks = text.split()
            rows: list[list[float]] = []
            i = 0
            for _ in range(npts):
                i += 1  # 点番号
                row: list[float] = []
                for _v in range(nvar):
                    if cplx:
                        a, b = toks[i].split(",")
                        row += [float(a), float(b)]
                    else:
                        row.append(float(toks[i]))
                    i += 1
                rows.append(row)
            arr = np.array(rows, dtype=float).reshape(npts, nvar * width)
            # ascii の次プロットは次の "Title:" 行から始まる
            nxt = re.search(r"^Title:", text, re.M)
            if nxt is not None:
                pos = body_start + len(text[: nxt.start()].encode("latin-1"))
            else:
                pos = len(data)
        vecs: dict[str, np.ndarray] = {}
        for k, (name, _t) in enumerate(variables):
            if cplx:
                vecs[name] = arr[:, 2 * k] + 1j * arr[:, 2 * k + 1]
            else:
                vecs[name] = arr[:, k]
        plots.append(
            {
                "title": hdr.get("Title", ""),
                "plot": hdr.get("Plotname", ""),
                "complex": cplx,
                "vars": variables,
                "data": vecs,
                "points": npts,
            }
        )
    return plots


def _pick_plot(plots: list[dict]) -> dict | None:
    """表示するプロット: 掃引（点数 2 以上）のうち最後のもの。無ければ最後。"""
    if not plots:
        return None
    swept = [p for p in plots if p["points"] > 1]
    return (swept or plots)[-1]


def _decimate_indices(n: int, max_points: int) -> np.ndarray:
    """点番号で等間隔に間引く（先頭・末尾は保持）。

    ngspice の時間刻みは適応的で、信号の遷移付近に点が集中する。点番号で
    等間隔に間引くとその密度分布がそのまま残るため、エッジ形状が保たれる。
    """
    if n <= max_points:
        return np.arange(n)
    return np.unique(np.linspace(0, n - 1, max_points).round().astype(int))


def _round_list(values: np.ndarray) -> list[float]:
    # 有効数字 7 桁程度に丸めて JSON を小さくする
    return [float(f"{v:.7g}") for v in values.tolist()]


def plot_to_result(plot: dict, *, max_points: int = DEFAULT_MAX_POINTS) -> dict:
    """eecircuit-engine の ResultType と同じ形に変換する。"""
    names = [n for n, _ in plot["vars"]]
    types = {n: t for n, t in plot["vars"]}
    data = plot["data"]
    idx = _decimate_indices(len(data[names[0]]), max_points)
    out: list[dict] = []
    for name in names:
        v = data[name][idx]
        if plot["complex"]:
            values = [
                {"real": float(f"{c.real:.7g}"), "img": float(f"{c.imag:.7g}")}
                for c in v
            ]
        else:
            values = _round_list(np.real(v))
        out.append({"name": name, "type": types[name], "values": values})
    return {
        "header": f"{plot['title']}\n{plot['plot']}",
        "numVariables": len(names),
        "variableNames": names,
        "numPoints": int(len(idx)),
        "dataType": "complex" if plot["complex"] else "real",
        "data": out,
    }


# ------------------------------------------------------------------ 実行


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


_LOG_NOISE_RE = re.compile(r"DRAM|pages =|program size|^\s*Stack =", re.I)
_ERROR_LINE_RE = re.compile(r"^\s*(error|fatal)\b|\berror:", re.I)


def _log_errors(log: str) -> list[str]:
    out: list[str] = []
    for line in log.splitlines():
        if _ERROR_LINE_RE.search(line):
            s = line.strip()
            if s and s not in out:
                out.append(s)
    return out[:50]


def run_netlist(
    netlist: str,
    *,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_points: int = DEFAULT_MAX_POINTS,
) -> dict:
    """ネットリストを ngspice で実行し {data, info, errors, ...} を返す。

    data はプロットが得られなかった場合 None。
    """
    ngspice = find_ngspice()
    if ngspice is None:
        raise SimulationError(simulator_status()["detail"])
    text, use_dash_r = prepare_netlist(netlist)

    with tempfile.TemporaryDirectory(prefix="agilex-sim-") as tmp:
        d = Path(tmp)
        (d / "netlist.cir").write_text(text, encoding="utf-8")
        # 対話用の初期化ファイルを読まないよう、空の .spiceinit を置く
        (d / ".spiceinit").write_text("* agilex studio\n", encoding="utf-8")
        cmd = [ngspice, "-b", "-o", "log.txt"]
        if use_dash_r:
            cmd += ["-r", "out.raw"]
        cmd.append("netlist.cir")
        env = {**os.environ, "OMP_NUM_THREADS": os.environ.get("OMP_NUM_THREADS", "1")}
        t0 = time.monotonic()
        proc = subprocess.Popen(
            cmd,
            cwd=d,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        timed_out = False
        try:
            stdout, _ = proc.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_group(proc)
            stdout, _ = proc.communicate()
        elapsed = time.monotonic() - t0

        log_path = d / "log.txt"
        log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.is_file() else ""
        console = (stdout or b"").decode("utf-8", errors="replace")
        errors = _log_errors(log + "\n" + console)
        if timed_out:
            errors.insert(0, f"simulation timed out after {timeout_s:g} s")
        elif proc.returncode not in (0, None) and not errors:
            errors.append(f"ngspice exited with status {proc.returncode}")

        plots: list[dict] = []
        raws = sorted(d.glob("*.raw"), key=lambda p: p.stat().st_mtime)
        for raw in raws:
            try:
                plots.extend(read_raw_plots(raw))
            except (ValueError, KeyError, IndexError) as exc:
                errors.append(f"could not read {raw.name}: {exc}")
        plot = None if timed_out else _pick_plot(plots)

        info_lines = [
            f"ngspice: {_version(ngspice) or ngspice} (server)",
            f"elapsed: {elapsed:.2f} s",
        ]
        result = None
        if plot is not None:
            result = plot_to_result(plot, max_points=max_points)
            info_lines.append(
                f"plot: {plot['plot']} — {plot['points']} points"
                + (
                    f" (decimated to {result['numPoints']} for display)"
                    if result["numPoints"] < plot["points"]
                    else ""
                )
            )
        tail = [
            ln
            for ln in log.strip().splitlines()
            if ln.strip() and not _LOG_NOISE_RE.search(ln)
        ][-12:]
        return {
            "data": result,
            "info": "\n".join(info_lines + tail),
            "errors": errors,
            "elapsed_s": round(elapsed, 3),
        }
