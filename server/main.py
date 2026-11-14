"""Agile-X Studio layout / simulation API (gdsfactory + KLayout + ngspice)."""

from __future__ import annotations

import gdsfactory as gf
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

# Activate the generic PDK before importing layout modules.
gf.gpdk.PDK.activate()

from server.fab import (
    get_base_gds_path,
    load_gate_array_catalog,
    load_primitive_catalog,
)
from server.layout import sync_layout_from_netlist
from server.layout_view import RENDERER
from server.spice import (
    NetlistRejected,
    SimulationError,
    run_netlist,
    simulator_status,
)

app = FastAPI(title="Agile-X Studio Layout API")
# フロントエンドは Vite の /api プロキシ経由（同一オリジン）でアクセスする。
# サーバは任意のネットリストを ngspice で実行するため、他サイトのページから
# localhost の API を叩けないよう、許可オリジンはローカル開発サーバに限定する。
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
# 波形 JSON は数 MB になるため圧縮して返す
app.add_middleware(GZipMiddleware, minimum_size=4096)


class SyncRequest(BaseModel):
    netlist: str


class SimulateRequest(BaseModel):
    netlist: str


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/fab/gate-array")
def gate_array_catalog() -> dict:
    return load_gate_array_catalog()


@app.get("/api/fab/primitives")
def primitive_catalog() -> dict:
    return load_primitive_catalog()


@app.post("/api/layout/sync")
def layout_sync(body: SyncRequest) -> dict:
    try:
        return sync_layout_from_netlist(body.netlist)
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/layout/view")
def layout_view() -> dict:
    """表示中のレイアウト（同期済みなら combined.gds、まだなら base.gds）の範囲とレイヤ。"""
    return RENDERER.info()


@app.get("/api/layout/tile/{level}/{ix}/{iy}.png")
def layout_tile(level: int, ix: int, iy: int, m: str | None = None, v: int = 0) -> Response:
    """サーバ側で描いたレイアウトのタイル（v はキャッシュ破棄用のリビジョン）。"""
    try:
        png = RENDERER.tile(level, ix, iy, m)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/layout/image.png")
def layout_image(
    w: int = 1600,
    h: int = 1200,
    x0: float | None = None,
    y0: float | None = None,
    x1: float | None = None,
    y1: float | None = None,
    m: str | None = None,
) -> Response:
    """指定範囲（µm、省略時はチップ全体）を 1 枚の PNG に描く（印刷・別タブ表示用）。"""
    box = None
    if None not in (x0, y0, x1, y1):
        box = (float(x0), float(y0), float(x1), float(y1))  # type: ignore[arg-type]
    try:
        png = RENDERER.image(box, w, h, m)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/api/simulate/status")
def simulate_status() -> dict:
    """サーバ側シミュレータ（ngspice）の有無とバージョン。"""
    return simulator_status()


@app.post("/api/simulate")
def simulate(body: SimulateRequest) -> dict:
    """ネットリストをサーバ側の ngspice で実行し、波形を返す。

    同期エンドポイント（FastAPI のスレッドプールで実行）なので、
    実行中も他の API はブロックされない。
    """
    try:
        return run_netlist(body.netlist)
    except NetlistRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SimulationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
