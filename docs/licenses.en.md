# Licenses

The source code of Agile-X Studio (`src/`, `server/`, `scripts/`, `docs/`) is released under the
[MIT License](https://github.com/kadomoto-lab/agile-x-studio/blob/main/LICENSE). The tools and libraries it uses keep
their own licenses.

## Software it uses

| Software | License | How it is used |
|---|---|---|
| [ngspice](https://ngspice.sourceforge.io/) | BSD-3-Clause (and others; see its distribution) | run as a separate process (simulation); installed separately by the user |
| [KLayout](https://www.klayout.de/) Python module (`klayout`) | GPL-3.0-or-later | **imported by the API server and scripts** (reading and writing GDS, drawing layout tiles); installed from PyPI by pip |
| [gdsfactory](https://github.com/gdsfactory/gdsfactory), [kfactory](https://github.com/gdsfactory/kfactory) | MIT, MIT | imported by the API server (building and merging GDS) |
| [FastAPI](https://fastapi.tiangolo.com/), [uvicorn](https://www.uvicorn.org/) | MIT, BSD-3-Clause | the API server |
| [React](https://react.dev/), [Vite](https://vite.dev/) | MIT, MIT | the interface |
| [@xyflow/react](https://reactflow.dev/) | MIT | the schematic editor |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) (`@monaco-editor/react`) | MIT | the netlist editor |
| [uPlot](https://github.com/leeoniya/uPlot) | MIT | waveforms |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | styling |
| [lucide-react](https://lucide.dev/) | ISC | icons |

## Distribution { #distribution }

**The repository and the built interface can be distributed under the MIT License.** The repository contains no
code copied from GPL software. The layout is drawn into PNG images by the API server with KLayout, and the browser
only lays those images out, so the output of `npm run build` (`dist/`) contains no GPL code either (the same approach
as [Undine](https://github.com/kadomoto-lab/undine-eda)).

**The API server works together with KLayout.** It imports the GPL-3.0-or-later `klayout` module (gdsfactory depends
on it too). The module is installed from PyPI by pip and is not part of the repository. The MIT License is compatible
with GPLv3, which is why Agile-X Studio's own code stays under the MIT License.

**Distributing the API server together with KLayout.** Whoever distributes the API server and the `klayout` module
together, for example in a container image, a VM image or an installer, distributes the combination under GPL-3.0 and
must meet its terms for it.

## Agile-X gate-array data

`public/base.gds`, `public/base_forfab.gds`, `public/spice/z_gabasecell.sp` and `public/fab/` describe the base and
base cell of the [Agile-X](https://www.agile-x.t.u-tokyo.ac.jp/en/) gate array.
