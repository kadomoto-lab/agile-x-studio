# Architecture and development

How Agile-X Studio is built, and the rules for changing it. For how to use it, see the [user guide](guide/schematic.md).

## Structure

```text
Browser (React 19 + Vite + TypeScript)
  ├─ Schematic        @xyflow/react
  ├─ Netlist          Monaco Editor
  ├─ Waveforms        uPlot
  └─ Layout           canvas (lays out tiles drawn on the server)
        │  /api (in development Vite forwards it to 127.0.0.1:8000)
        ▼
API server (FastAPI + uvicorn)
  ├─ /api/simulate      → server/spice.py  → ngspice (separate process, batch)
  ├─ /api/layout/sync   → server/layout.py → server/ga_*.py (place, route, verify)
  │                                         → GDS written with gdsfactory / KLayout
  └─ /api/layout/tile   → server/layout_view.py → PNG drawn with KLayout's LayoutView
```

- Only the interface code and images reach the browser. KLayout (GPL) is used only as a Python module on the server
  (see [Licenses](licenses.md#distribution)).
- The circuit's state (schematic, netlist, undo history) lives only in the browser. The API server keeps no state: each
  request carries the netlist and gets a result. Only the generated GDS files are written, to `public/generated/`.
- Conversion between the schematic and the netlist happens in the browser (`src/schematic/`).

## Directories

| Path | Contents |
|---|---|
| `src/App.tsx` | the whole screen, running simulations |
| `src/hooks/useCircuitProject.ts` | circuit state, undo history, keeping schematic and netlist in step |
| `src/components/` | screen components (`SchematicEditor`, `WaveformViewer`, `GdsViewer`, …) |
| `src/schematic/` | schematic data, the part library, netlist conversion both ways, auto-layout, wire paths |
| `src/samples/circuits.ts` | the sample circuits |
| `src/lib/` | API calls (`simulation.ts`, `layoutApi.ts`), waveform conversion, layout tiles and camera (`layoutView.ts`) |
| `src/i18n/` | interface strings (`ja.ts` is the source, `en.ts` the translation) |
| `server/main.py` | the API endpoints |
| `server/spice.py` | finding ngspice, preparing the netlist, running it, reading `.raw` files |
| `server/layout.py` | the layout sync entry point, merging GDS files |
| `server/layout_view.py` | drawing layout tiles (KLayout's LayoutView), the layer list, images for printing |
| `server/ga_netlist.py`, `ga_extract.py` | gates and connections from the netlist |
| `server/ga_placement.py` | placement on the gate array |
| `server/ga_grid_router.py` | A* routing on a 10 µm grid (jumpers, paint that can be rolled back) |
| `server/ga_global_route.py`, `ga_jumper_climb.py`, `ga_channel_router.py` | routes between rows, jumper registration, structured routes |
| `server/ga_io_pads.py` | I/O pad positions and routes |
| `server/ga_sync.py` | the place → route → verify → write flow, and retries |
| `server/ga_verify.py` | independent verification from the output shapes (shorts, opens, spacing) |
| `server/ga_overlay.py` | writing routes and labels to GDS |
| `server/data/layers.lyp` | layer colors of the layout view |
| `scripts/` | building `gate-array.json` |
| `public/` | the base GDS files, gate-array data, the SPICE library |
| `docs/` | this documentation (MkDocs) |
| `pyproject.toml`, `uv.lock` | Python dependencies and their pinned versions ([uv](https://docs.astral.sh/uv/)) |

## Checks

Run these after a change:

```bash
npx tsc -b                       # type check
npm run lint                     # ESLint
npm run test:ga                  # placement and routing tests (uv run python server/test_ga_layout.py)
npm run build                    # build
```

`server/test_ga_layout.py` syncs inverter chains, mixes with NAND2, I/O pads, and ring oscillators, fan-outs and random
connections across two to three rows, and checks that each passes verification. It also checks that the verifier
catches shorts and opens. It takes a few tens of seconds and writes `public/generated/test_*.gds` (ignored by git).

Always run it after changing placement or routing (`server/ga_*.py`).

## Interface strings (i18n)

| Item | Rule |
|---|---|
| Source | Japanese |
| Where strings live | `src/i18n/ja.ts` (source), `src/i18n/en.ts` (translation), types in `src/i18n/types.ts` |
| Code comments | stay in Japanese (not translated) |
| Switching | at runtime (top right of the header); the choice is saved in localStorage |
| First language | the saved choice → `VITE_LOCALE` (`ja` if unset) |

Components read strings with `import { messages } from '../i18n'` and never hard-code interface text.

- `messages` is an ES module live binding that `setLocale()` swaps. Read `messages.…` at render time (in JSX or event
  handlers); do not capture strings at module top level or in `useMemo`.
- `App` re-renders through `useLocale()`. A `memo`ized component that uses strings must call `useLocale()` itself.
- Values computed from strings (such as waveform axis labels) list the locale as a dependency.

### Adding a string

1. Add the key to `src/i18n/types.ts`
2. Write the Japanese in `src/i18n/ja.ts`
3. Write the English in `src/i18n/en.ts`
4. Read it as `messages.…` in the component

`tsc` fails when the two catalogs differ, so a missing string shows up before the build.

Part names (Resistor, INV, …), SPICE and file names, and server logs and comments are not translated.

## Documentation

The documentation is built with [MkDocs](https://www.mkdocs.org/) and
[Material for MkDocs](https://squidfunk.github.io/mkdocs-material/). Japanese is the source: `page.md` is Japanese
and `page.en.md` English ([mkdocs-static-i18n](https://github.com/ultrabug/mkdocs-static-i18n)).

```bash
npm run docs:serve   # http://127.0.0.1:8001 (uv run --only-group docs mkdocs serve)
npm run docs:build   # into site/ (uv run --only-group docs mkdocs build --strict)
```

On a push to `main`, GitHub Actions (`.github/workflows/docs.yml`) builds the site and publishes it to GitHub Pages.

When you add or change a page, update both languages. Describe the interface with the same words as its strings
(`src/i18n/`). Screenshots go in `docs/images/ja/` and `docs/images/en/`, each taken with the interface in that
language.
