# Install

Agile-X Studio has two parts: the web interface (served by Vite's development server) and the API server (Python) that
runs simulations and builds layouts. Both run on the same machine.

## 1. Requirements { #requirements }

| You need | Check | Get it |
|---|---|---|
| Linux, macOS, or Windows with WSL2 | | Tested on Ubuntu (WSL2) |
| Node.js 20 or later | `node --version` | [per OS](#per-os) |
| [uv](https://docs.astral.sh/uv/) | `uv --version` | [per OS](#per-os) |
| ngspice | `ngspice --version` | [per OS](#per-os), or `conda install -c conda-forge ngspice` |
| git | `git --version` | [per OS](#per-os) |

uv provides Python 3.12 or later: it uses one already on the machine, or downloads one if there is none.

### Per OS { #per-os }

Typical ways to install them. OS packages of Node.js are often too old, so it comes from
[nvm](https://github.com/nvm-sh/nvm).

=== "Ubuntu / Debian family (including WSL2)"

    ```bash
    sudo apt update
    sudo apt install -y git curl ngspice
    curl -LsSf https://astral.sh/uv/install.sh | sh  # uv
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash  # nvm
    source ~/.bashrc  # or open a new terminal
    nvm install 22  # Node.js 22
    ```

    Ubuntu's own `nodejs` package is too old (18 on 24.04), so Node.js comes from nvm. Even where the OS's Python is
    older than 3.12, as on Ubuntu 22.04, uv fetches and uses 3.12 or later.

=== "macOS (Homebrew)"

    ```bash
    xcode-select --install  # git, if not installed yet
    brew install node uv ngspice
    ```

=== "Windows"

    Run it inside Ubuntu on WSL2. Open PowerShell as administrator and run the command below; after restarting,
    open Ubuntu and follow the Ubuntu / Debian steps.

    ```powershell
    wsl --install -d Ubuntu-24.04
    ```

Check each with the command in the "Check" column above.

## 2. Get it and install

```bash
git clone https://github.com/kadomoto-lab/agile-x-studio.git
cd agile-x-studio
uv sync
npm install
```

`uv sync` installs Python and the dependencies listed in `pyproject.toml` (gdsfactory, the KLayout Python module,
FastAPI, uvicorn, …) into `.venv`, at the versions pinned in `uv.lock`.

npm scripts call Python through `uv run`, so there is no venv to activate.

## 3. Start

```bash
npm run dev
```

This starts two processes:

| What | Address |
|---|---|
| Web interface (Vite development server) | <http://localhost:5173> |
| Layout / simulation API | <http://127.0.0.1:8000> (the interface reaches it through `/api`) |

Before starting, `npm run dev` builds the gate-array data (`public/fab/gate-array.json`) from `base.gds`.

Open <http://localhost:5173> in your browser.

## 4. Check

You are ready when the console at the bottom shows:

```text
> Simulator ready (server: ngspice-42)
```

`ngspice-42` is the version of the ngspice that was found. Press **Run simulation** at the top right, and the
waveforms of the sample 31-stage ring oscillator appear on the right.

To check the API server alone:

```bash
curl http://127.0.0.1:8000/api/simulate/status
```

```json
{"available": true, "simulator": "ngspice", "path": "/usr/bin/ngspice", "version": "ngspice-42"}
```

If it says `"available": false`, `detail` gives the reason. See
[Troubleshooting](../troubleshooting.md#ngspice-not-found).

## Choose the ngspice to use { #ngspice-location }

The API server looks for ngspice in this order:

1. the environment variable `AGILEX_NGSPICE` (path to the executable)
2. `$UNDINE_TOOLS/bin`
3. the `bin` directory of the Python environment that runs the API server (`.venv`)
4. `~/undine-tools/bin`
5. `PATH`

To use a particular ngspice, start with `AGILEX_NGSPICE`:

```bash
AGILEX_NGSPICE=/opt/ngspice/bin/ngspice npm run dev
```

The other environment variables are in [Commands and configuration](../reference/configuration.md).

## Start with the English interface

```bash
npm run dev:en
```

This opens in English. Whichever you start, the toggle at the top right switches the language.

## Next

- [Your first circuit](first-circuit.md): extend a two-stage inverter chain and take it through simulation and layout.
