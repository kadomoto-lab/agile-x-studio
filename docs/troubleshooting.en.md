# Troubleshooting and FAQ

Common problems, grouped by the message you see. Search this page for a few words of your message.

## Start and install

### `uv: command not found`

uv is not installed, or not on your `PATH`. Install it as in [Install](getting-started/install.md#per-os), then open a
new terminal (the official installer puts it in `~/.local/bin`).

### `ModuleNotFoundError: No module named 'klayout'` (or `gdsfactory`, `fastapi`)

The dependencies are not in `.venv`. Run `uv sync` in the repository's directory. Run it again whenever
`pyproject.toml` or `uv.lock` changes, for example after a `git pull`.

### `error: externally-managed-environment`

This appears when `pip install` targets the system Python. This project does not use pip: install with `uv sync`,
which puts everything in `.venv`.

### `address already in use`

Port 8000 (the API server) is used by another program. Stop it, or check that an earlier `npm run dev` is not still
running. If port 5173 is in use, Vite starts on a free port such as 5174; open the address it prints.

## Simulation

### ngspice not found { #ngspice-not-found }

The console shows:

```text
ERROR: Server-side simulator unavailable — ngspice not found. Install it ...
```

Install ngspice ([Install](getting-started/install.md#requirements)), or point `AGILEX_NGSPICE` at it and restart the
API server:

```bash
AGILEX_NGSPICE=/path/to/ngspice npm run dev
```

`curl http://127.0.0.1:8000/api/simulate/status` shows what the API server found.

### `Cannot reach the simulation API`

The API server is not running. Look for `api` errors in the terminal where you ran `npm run dev`. If you started the
interface alone with `npm run dev:vite`, run `npm run dev:api` in another terminal.

Right after starting, the API server can take a moment. The interface keeps retrying for about 30 seconds.

### `simulation timed out after 120 s`

The simulation did not finish in 120 seconds. Shorten the `.tran` range or raise its maximum step. For long runs,
start the API server with a larger `AGILEX_SIM_TIMEOUT` (seconds).

### The waveforms look coarse

Results with more than 8000 points are thinned out for display. Simulate only the range you want to see, or raise
`AGILEX_SIM_MAX_POINTS`; more points also means more data sent to the browser.

### `ERROR: unknown subckt: ...`

The netlist lacks the definition of a subcircuit such as `INV`. If you wrote the netlist by hand, put the
[preamble](guide/netlist.md#preamble) at the top.

### `ERROR: No plottable signals in simulation result`

There is nothing to plot: the only analysis is `.op`, or every signal is constant. Use `.tran` or `.ac`.

## Layout

### `Cannot show the layout`

The layout images could not be fetched from the API server. Check that it is running and that the terminal where you
ran `npm run dev` shows no errors.

### `combined.gds is missing`

The layout has never been synced, so there is no file to download. Press **Sync Layout**.

### Parts of the layout are missing or stay blurry

When you zoom, tiles for the new scale are drawn by the API server and loaded. Coarser tiles fill in meanwhile, so wait
a moment. A tile that failed to load is fetched again the next time the view moves.

### `Layout sync failed (HTTP 422): ...`

Placement and routing did not succeed in any attempt. For what to do about each reason, see
[Layout: When a sync fails](guide/layout.md#sync-errors).

### The Layout tab keeps showing **unsynced**

The netlist changed after the layout was built. Press **Sync Layout**.

### `Popup blocked. Please allow popups`

**Print** and **Open in new tab** open a new window. Allow popups for this site in your browser.

## FAQ

### Does the simulation match a real chip?

No. The transistors use LEVEL=1 models, meant for checking logic and rough delays.

### Can I use it for layouts other than the gate array, or for other processes?

No. Placement and routing are specific to the Agile-X gate array (`base.gds`). Circuits without gate-array parts can
still be simulated.

### Does it work without ngspice?

The schematic, netlist and layout work. Only simulation does not.

### Can I put it on the internet?

Not recommended. The API server has no authentication and runs ngspice on any netlist it receives. If you do, add
authentication and isolate where ngspice runs.

### Where do I report a bug?

Open an issue on [GitHub](https://github.com/kadomoto-lab/agile-x-studio/issues). These help:

- what you did, what happened, and what you expected
- the netlist (the contents of the Netlist tab)
- the console output, and the output of the terminal running `npm run dev`
- your OS and the versions of Node.js, Python and ngspice
