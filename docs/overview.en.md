# Overview

Agile-X Studio is an app for designing and checking digital circuits for the Agile-X gate array in the browser.
It shows one circuit in three views.

| View | What it is for |
|---|---|
| **Schematic** | Place parts and wire them. The circuit's source of truth is either this or the netlist |
| **Netlist** | Edit the SPICE netlist as text |
| **Layout** | The circuit placed and routed on the gate array, drawn over the base GDS |

Waveforms appear on the right and the console at the bottom shows simulation results and logs.

## How it works

```text
Browser (React + Vite)                      API server (FastAPI, 127.0.0.1:8000)
┌───────────────────────────┐   /api/*    ┌──────────────────────────────────────┐
│ Schematic / Netlist        │ ──────────▶ │ /api/simulate     → ngspice (batch)    │
│ Waveforms (uPlot)          │ ◀────────── │ /api/layout/sync  → place, route,      │
│ Layout (canvas)            │ ◀────────── │ /api/layout/tile  → PNG via KLayout    │
└───────────────────────────┘             └──────────────────────────────────────┘
```

- **Simulation**: the browser sends the netlist to `POST /api/simulate`. The server runs `ngspice -b` in a temporary
  directory and returns the waveforms as JSON, thinned out for display when there are many points.
- **Layout**: the browser sends the netlist to `POST /api/layout/sync`. The server extracts the gates, places them on
  the gate array, routes them in METAL5 and verifies the result. It then writes the GDS merged with `base.gds`.
- **Showing the layout**: the API server draws the GDS into PNG tiles with the KLayout Python module, and the browser
  lays the tiles out. Only images reach the browser.
- In development, Vite forwards `/api` to the API server, so the browser sees a single origin.

## The gate array

The Agile-X gate array is **9 rows × 35 columns = 315** copies of the base cell `Z__GABASECELL`. Each base cell holds
two PMOS and two NMOS transistors, and how its METAL5 pins are wired makes it an INV, a NAND2 or a NOR2.

| Part | Base cells | Placement |
|---|---|---|
| INV, NAND2, NOR2, `Z__GABASECELL` | one per gate | placed and routed on the gate array |
| NMOS, PMOS, MOS Cap, R, C, L, sources | none | simulation only |

A circuit that does not fit in one row is spread over several rows, and the routes between rows use jumpers built
into the base. See [Layout](guide/layout.md) and [Gate array](reference/gate-array.md).

!!! note "About the simulation models"
    The base cell's transistors use the **LEVEL=1 models** in the netlist preamble (`NMOSMOD1` / `PMOSMOD1`). They
    are for checking logic and rough delays; they do not describe a real process.

## What it does not do

- You cannot edit the placement or routing by hand. The layout is always rebuilt from the netlist.
- There is no full DRC or LVS. Verification checks the METAL5 shapes that are written out for shorts, opens and
  spacing only.
- The API server has no authentication. Run it on your own machine or on a network you trust.
