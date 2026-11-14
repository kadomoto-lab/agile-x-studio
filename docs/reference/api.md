# HTTP API

API サーバ（`server/main.py`、FastAPI）のエンドポイントです。開発時は <http://127.0.0.1:8000> で動き、画面からは Vite の `/api` 中継を通して呼ばれます。FastAPI が生成する対話的なドキュメントは
<http://127.0.0.1:8000/docs> で見られます。

!!! warning "認証はありません"
    API はネットリストを受け取って ngspice を実行します。サーバは `127.0.0.1` だけで待ち受け、ブラウザからは `localhost` / `127.0.0.1` のページからの呼び出しだけを許可しています（CORS）。外部に公開する場合は、認証や実行環境の隔離を別に用意してください。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/health` | 死活確認 |
| GET | `/api/simulate/status` | ngspice が使えるか |
| POST | `/api/simulate` | ネットリストをシミュレーションする |
| POST | `/api/layout/sync` | ネットリストからレイアウトを作る |
| GET | `/api/layout/view` | 表示中のレイアウトの範囲とレイヤ |
| GET | `/api/layout/tile/{level}/{ix}/{iy}.png` | レイアウトのタイル画像 |
| GET | `/api/layout/image.png` | 指定範囲のレイアウト画像（印刷・別タブ表示用） |
| GET | `/api/fab/gate-array` | ゲートアレイの情報（`public/fab/gate-array.json`） |
| GET | `/api/fab/primitives` | ゲートの定義（`public/fab/primitives.json`） |

リクエストの本文は JSON（`Content-Type: application/json`）です。それ以外の形式は 422 で拒否されます。

## GET /api/health

```json
{"status": "ok"}
```

## GET /api/simulate/status

```json
{
  "available": true,
  "simulator": "ngspice",
  "path": "/home/user/undine-tools/bin/ngspice",
  "version": "ngspice-42"
}
```

ngspice が見つからないときは `"available": false` になり、`detail` に探した場所と対処が入ります。

## POST /api/simulate

```bash
curl -s http://127.0.0.1:8000/api/simulate \
  -H 'Content-Type: application/json' \
  -d '{"netlist": "* rc\nR1 in out 1k\nC1 out 0 1u\nV1 in 0 sin(0 1 1k)\n.tran 10u 5m\n.end\n"}'
```

**リクエスト**

| フィールド | 型 | 内容 |
|---|---|---|
| `netlist` | string | SPICE ネットリスト（2 MB まで） |

**レスポンス**

| フィールド | 型 | 内容 |
|---|---|---|
| `data` | object \| null | 波形。最後の掃引結果。得られなかったときは `null` |
| `info` | string | ngspice のバージョン、実行時間、プロット名と点数、ログの抜粋 |
| `errors` | string[] | ngspice のエラー、タイムアウトなど |
| `elapsed_s` | number | 実行時間（秒） |

`data` の形（eecircuit-engine の `ResultType` と同じ）:

```json
{
  "header": "* rc\nTransient Analysis",
  "numVariables": 3,
  "variableNames": ["time", "v(in)", "v(out)"],
  "numPoints": 526,
  "dataType": "real",
  "data": [
    {"name": "time", "type": "time", "values": [0, 1e-05, ...]},
    {"name": "v(in)", "type": "voltage", "values": [0, 0.0628, ...]},
    {"name": "v(out)", "type": "voltage", "values": [0, 0.0003, ...]}
  ]
}
```

`.ac` などの複素数の結果では `dataType` が `"complex"` になり、`values` は `{"real": ..., "img": ...}` の配列です。点数が `AGILEX_SIM_MAX_POINTS`（既定 8000）を超えるときは、等間隔に間引きます。

**エラー**

| ステータス | 理由 |
|---|---|
| 400 | ネットリストが大きすぎる、または `.control` に `shell`・`exec`・`system` がある |
| 422 | 本文が JSON でない、または `netlist` がない |
| 503 | ngspice が見つからない |

ngspice 自体のエラー（文法の誤りなど）は 200 で返り、`errors` に入ります。

## POST /api/layout/sync

ネットリストのゲートをゲートアレイに配置・配線し、GDS を `public/generated/` に書き出します。

**リクエスト**

| フィールド | 型 | 内容 |
|---|---|---|
| `netlist` | string | SPICE ネットリスト |

**レスポンス**

```json
{
  "status": "ok",
  "revision": 482915733,
  "overlay_gds": "public/generated/schematic_overlay.gds",
  "combined_gds": "public/generated/combined.gds",
  "combined_forfab_gds": "public/generated/combined_forfab.gds",
  "ga_instances": 36,
  "gates_placed": 36,
  "wire_segments": 9192,
  "placement_rows": {"0": [0, 1, 2, ...], "1": [0, 1, 2, ...]}
}
```

| フィールド | 内容 |
|---|---|
| `revision` | `combined.gds` の内容から作った番号。画面はこれが変わるとレイアウトの表示を読み直す |
| `ga_instances` / `gates_placed` | 取り出したゲートの数と、配置したゲートの数 |
| `wire_segments` | 配線の線分の数 |
| `placement_rows` | 行番号ごとの、使った列番号 |

**エラー**

| ステータス | 理由 |
|---|---|
| 422 | 配置・配線・検証がすべての試行で失敗した、または `GA_IO` 行の誤り。`detail` に理由 |

レイアウトの同期は、一度に 1 つずつ実行してください。出力先のファイルは 1 組しかないため、同時に呼ぶと結果が混ざります。

## GET /api/layout/view

表示するレイアウト（同期済みなら `combined.gds`、まだなら `base.gds`）の情報です。

```json
{
  "revision": 482915733,
  "file": "combined.gds",
  "dbu": 0.001,
  "bbox": [0, 0, 5800000, 4990000],
  "tile_px": 512,
  "background": "#0b0f14",
  "layers": [
    {"id": 0, "name": "METAL4 drawing", "source": "31/0", "fill": "#e8a838", "icon": "iVBORw0KG..."},
    ...
  ]
}
```

| フィールド | 内容 |
|---|---|
| `revision` | ファイルの内容から作った番号（`/api/layout/sync` の `revision` と同じ計算） |
| `dbu` | データベース単位（µm） |
| `bbox` | 全体の範囲 `[left, bottom, right, top]`（dbu） |
| `tile_px` | タイル 1 枚の大きさ（ピクセル） |
| `layers` | レイヤの一覧。`id` はマスクのビット番号、`icon` は見本の PNG（base64） |

## GET /api/layout/tile/{level}/{ix}/{iy}.png

レイアウトのタイルを PNG で返します。タイル `(level, ix, iy)` は、W = `tile_px` × 2<sup>level</sup> dbu として、[ix·W, (ix+1)·W] × [iy·W, (iy+1)·W] の範囲を `tile_px` 四方に描いたものです。`level` は 0〜30 です。

| クエリ | 内容 |
|---|---|
| `m` | 表示するレイヤのマスク（16 進。1 桁が 4 レイヤ、下位ビットから `id` 順）。省略するとすべて表示 |
| `v` | キャッシュを捨てるための番号（`revision` を渡す）。描画には使わない |

## GET /api/layout/image.png

指定した範囲を 1 枚の PNG に描きます。印刷と **新しいタブで開く** に使います。

| クエリ | 既定値 | 内容 |
|---|---|---|
| `w`、`h` | 1600、1200 | 画像の大きさ（ピクセル、最大 4096） |
| `x0`、`y0`、`x1`、`y1` | チップ全体 | 範囲（µm） |
| `m` | すべて表示 | レイヤのマスク（タイルと同じ） |
