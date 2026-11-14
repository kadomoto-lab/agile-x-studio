# Commands and configuration

## npm scripts

Scripts that use Python run through `uv run`, inside the `.venv` that `uv sync` creates. There is no venv to activate.

| Command | What it does |
|---|---|
| `npm run dev` | starts the interface (Vite, 5173) and the API server (8000) together; opens in Japanese |
| `npm run dev:en` | the same; opens in English |
| `npm run dev:vite` | starts the interface only |
| `npm run dev:api` | starts the API server only (`uv run uvicorn --reload`, `127.0.0.1:8000`) |
| `npm run build` | builds with Japanese as the default into `dist/` (same as `build:ja`) |
| `npm run build:en` | builds with English as the default into `dist-en/` |
| `npm run build:all` | builds both |
| `npm run preview` / `preview:en` | previews a build |
| `npm run lint` | ESLint |
| `npm run export:fab` | builds `public/fab/gate-array.json` from `base.gds` |
| `npm run test:ga` | placement and routing tests (`server/test_ga_layout.py`) |
| `npm run docs:serve` | serves the documentation site locally (<http://127.0.0.1:8001>) |
| `npm run docs:build` | builds the documentation site into `site/` (fails on broken links) |

To add a Python dependency, use `uv add <package>`, or `uv add --group docs <package>` for the documentation. Commit
both `pyproject.toml` and `uv.lock`, which it updates.

`dev` and `build` run `export:fab` first.

!!! note "Serving a build"
    `dist/` contains the interface only. Simulation and layout need the API server: route `/api` on the same origin
    to it, for example with a reverse proxy.

## Environment variables

### API server

| Variable | Default | Meaning |
|---|---|---|
| `AGILEX_NGSPICE` | | the ngspice executable to use; when set, no other location is searched |
| `UNDINE_TOOLS` | | look for ngspice in `$UNDINE_TOOLS/bin` |
| `AGILEX_SIM_TIMEOUT` | `120` | simulation time limit (seconds) |
| `AGILEX_SIM_MAX_POINTS` | `8000` | maximum number of points returned as waveforms |

The order in which ngspice is searched for is in [Install](../getting-started/install.md#ngspice-location).

### Interface

| Variable | Default | Meaning |
|---|---|---|
| `VITE_LOCALE` | `ja` | the first language (`ja` / `en`); also selects the build output (`dist/` / `dist-en/`) |

## Files

| Path | Contents | git |
|---|---|---|
| `pyproject.toml` | Python dependencies (the `docs` group is for the documentation) | tracked |
| `uv.lock` | pinned versions of the dependencies | tracked |
| `.venv/` | the Python environment created by `uv sync` | ignored |
| `public/base.gds` | the gate-array base | tracked |
| `public/base_forfab.gds` | the fabrication base (origin at the chip center) | tracked |
| `public/spice/z_gabasecell.sp` | the base cell's subcircuits and models | tracked |
| `public/fab/gate-array.json` | gate-array dimensions (built by `export:fab`) | tracked |
| `public/fab/primitives.json` | gates and their pins | tracked |
| `server/data/layers.lyp` | layer colors of the layout view (KLayout layer properties) | tracked |
| `public/generated/` | GDS files built by syncs | ignored |
