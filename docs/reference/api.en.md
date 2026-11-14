# HTTP API

The endpoints of the API server (`server/main.py`, FastAPI). In development it runs at <http://127.0.0.1:8000>, and the
interface calls it through Vite's `/api` forwarding. FastAPI's interactive documentation is at
<http://127.0.0.1:8000/docs>.

!!! warning "There is no authentication"
    The API takes a netlist and runs ngspice on it. The server listens on `127.0.0.1` only, and browsers may call it
    only from pages on `localhost` / `127.0.0.1` (CORS). If you expose it, add authentication and isolate where
    ngspice runs.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness check |
| GET | `/api/simulate/status` | whether ngspice is available |
| POST | `/api/simulate` | simulate a netlist |
| POST | `/api/layout/sync` | build the layout from a netlist |
| GET | `/api/layout/view` | extent and layers of the layout being shown |
| GET | `/api/layout/tile/{level}/{ix}/{iy}.png` | a tile image of the layout |
| GET | `/api/layout/image.png` | an image of an area of the layout (for printing and new tabs) |
| GET | `/api/fab/gate-array` | gate-array data (`public/fab/gate-array.json`) |
| GET | `/api/fab/primitives` | gate definitions (`public/fab/primitives.json`) |

Request bodies are JSON (`Content-Type: application/json`); anything else is rejected with 422.

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

When ngspice is not found, `"available"` is `false` and `detail` says where it looked and how to fix it.

## POST /api/simulate

```bash
curl -s http://127.0.0.1:8000/api/simulate \
  -H 'Content-Type: application/json' \
  -d '{"netlist": "* rc\nR1 in out 1k\nC1 out 0 1u\nV1 in 0 sin(0 1 1k)\n.tran 10u 5m\n.end\n"}'
```

**Request**

| Field | Type | Meaning |
|---|---|---|
| `netlist` | string | a SPICE netlist (up to 2 MB) |

**Response**

| Field | Type | Meaning |
|---|---|---|
| `data` | object \| null | the waveforms of the last sweep, or `null` if there were none |
| `info` | string | ngspice version, run time, plot name and point count, an excerpt of the log |
| `errors` | string[] | ngspice errors, the time limit, … |
| `elapsed_s` | number | run time in seconds |

The shape of `data` (the same as eecircuit-engine's `ResultType`):

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

Complex results such as `.ac` have `dataType` `"complex"`, and `values` is an array of `{"real": ..., "img": ...}`.
When there are more points than `AGILEX_SIM_MAX_POINTS` (8000 by default), they are thinned out at even intervals.

**Errors**

| Status | Reason |
|---|---|
| 400 | the netlist is too large, or a `.control` block contains `shell`, `exec` or `system` |
| 422 | the body is not JSON, or `netlist` is missing |
| 503 | ngspice was not found |

ngspice's own errors (syntax errors and so on) come back with 200, in `errors`.

## POST /api/layout/sync

Places and routes the netlist's gates on the gate array, and writes the GDS files to `public/generated/`.

**Request**

| Field | Type | Meaning |
|---|---|---|
| `netlist` | string | a SPICE netlist |

**Response**

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

| Field | Meaning |
|---|---|
| `revision` | a number derived from the contents of `combined.gds`; the interface reloads the layout view when it changes |
| `ga_instances` / `gates_placed` | gates extracted, and gates placed |
| `wire_segments` | the number of wire segments |
| `placement_rows` | for each row, the columns used |

**Errors**

| Status | Reason |
|---|---|
| 422 | placement, routing or verification failed in every attempt, or a `GA_IO` line is invalid; `detail` gives the reason |

Run one layout sync at a time. There is only one set of output files, so concurrent calls mix their results.

## GET /api/layout/view

Information about the layout being shown (`combined.gds` once synced, `base.gds` before that).

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

| Field | Meaning |
|---|---|
| `revision` | a number derived from the file's contents (computed as in `/api/layout/sync`) |
| `dbu` | the database unit (µm) |
| `bbox` | the whole extent `[left, bottom, right, top]` (dbu) |
| `tile_px` | the size of one tile (pixels) |
| `layers` | the layers; `id` is the bit number in the mask, `icon` a sample PNG (base64) |

## GET /api/layout/tile/{level}/{ix}/{iy}.png

Returns a tile of the layout as PNG. With W = `tile_px` × 2<sup>level</sup> dbu, the tile `(level, ix, iy)` shows
[ix·W, (ix+1)·W] × [iy·W, (iy+1)·W] drawn at `tile_px` square. `level` is 0–30.

| Query | Meaning |
|---|---|
| `m` | mask of the layers to show (hex; one digit per four layers, lowest bit first, in `id` order); all when omitted |
| `v` | a cache-busting number (pass the `revision`); not used for drawing |

## GET /api/layout/image.png

Draws an area as one PNG. Used by printing and **Open in new tab**.

| Query | Default | Meaning |
|---|---|---|
| `w`, `h` | 1600, 1200 | image size (pixels, up to 4096) |
| `x0`, `y0`, `x1`, `y1` | the whole chip | the area (µm) |
| `m` | all layers | layer mask (as for tiles) |
