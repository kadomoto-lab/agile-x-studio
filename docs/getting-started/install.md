# インストール

Agile-X Studio は、ブラウザで動く画面（Vite の開発サーバ）と、シミュレーション・レイアウトを受け持つ API サーバ（Python）の 2 つでできています。どちらも同じマシンで動かします。

## 1. 必要なもの { #requirements }

| 必要なもの | 確認方法 | 入手方法 |
|---|---|---|
| Linux、macOS、または Windows の WSL2 | | 動作確認は Ubuntu（WSL2）で行っています |
| Node.js 20 以上 | `node --version` | [OS ごとの入れ方](#per-os) |
| [uv](https://docs.astral.sh/uv/) | `uv --version` | [OS ごとの入れ方](#per-os) |
| ngspice | `ngspice --version` | [OS ごとの入れ方](#per-os)、または `conda install -c conda-forge ngspice` |
| git | `git --version` | [OS ごとの入れ方](#per-os) |

Python 3.12 以上は uv が用意します。マシンに 3.12 以上の Python があればそれを使い、なければ uv が取得します。

### OS ごとの入れ方 { #per-os }

典型的な入れ方です。Node.js は、OS のパッケージが古いことが多いので [nvm](https://github.com/nvm-sh/nvm) で入れます。

=== "Ubuntu / Debian 系（WSL2 を含む）"

    ```bash
    sudo apt update
    sudo apt install -y git curl ngspice
    curl -LsSf https://astral.sh/uv/install.sh | sh  # uv
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash  # nvm
    source ~/.bashrc  # または新しいターミナルを開く
    nvm install 22  # Node.js 22
    ```

    Ubuntu の `nodejs` パッケージは古い（24.04 で 18）ため、Node.js は nvm で入れます。Ubuntu 22.04 のように OS の Python が 3.12 より古くても、uv が 3.12 以上を取得して使います。

=== "macOS（Homebrew）"

    ```bash
    xcode-select --install  # git（未導入の場合）
    brew install node uv ngspice
    ```

=== "Windows"

    WSL2 の Ubuntu の中で動かします。PowerShell を管理者として開いて次を実行し、再起動後に Ubuntu を開いて、「Ubuntu / Debian 系」の手順に進んでください。

    ```powershell
    wsl --install -d Ubuntu-24.04
    ```

入ったかどうかは、上の表の「確認方法」のコマンドで確かめられます。

## 2. 取得とインストール

```bash
git clone https://github.com/kadomoto-lab/agile-x-studio.git
cd agile-x-studio
uv sync
npm install
```

`uv sync` は、Python と、`pyproject.toml` に書いた依存パッケージ（gdsfactory、KLayout の Python モジュール、FastAPI、uvicorn など）を、`uv.lock` で固定した版どおりに `.venv` に入れます。

npm スクリプトは Python を `uv run` 経由で呼ぶので、venv を有効にする必要はありません。

## 3. 起動

```bash
npm run dev
```

次の 2 つが同時に起動します。

| 起動するもの | アドレス |
|---|---|
| 画面（Vite 開発サーバ） | <http://localhost:5173> |
| レイアウト / シミュレーション API | <http://127.0.0.1:8000>（画面からは `/api` で中継） |

`npm run dev` は起動の前に、`base.gds` からゲートアレイの情報（`public/fab/gate-array.json`）を作ります。

ブラウザで <http://localhost:5173> を開いてください。

## 4. 確認

画面下のコンソールに、次の行が出れば準備完了です。

```text
> シミュレータ準備完了 (サーバ: ngspice-42)
```

`ngspice-42` の部分は、見つかった ngspice のバージョンです。そのあと右上の **シミュレーション実行** を押すと、サンプルの 31 段リングオシレータの波形が右側に出ます。

API サーバだけを確かめるときは、次のコマンドを使います。

```bash
curl http://127.0.0.1:8000/api/simulate/status
```

```json
{"available": true, "simulator": "ngspice", "path": "/usr/bin/ngspice", "version": "ngspice-42"}
```

`"available": false` のときは、`detail` に理由が入っています。[トラブルシューティング](../troubleshooting.md#ngspice-not-found) を参照してください。

## ngspice の場所を指定する { #ngspice-location }

API サーバは、次の順で ngspice を探します。

1. 環境変数 `AGILEX_NGSPICE`（実行ファイルのパス）
2. `$UNDINE_TOOLS/bin`
3. API サーバを動かしている Python 環境（`.venv`）の `bin`
4. `~/undine-tools/bin`
5. `PATH`

決まった ngspice を使いたいときは、`AGILEX_NGSPICE` を指定して起動します。

```bash
AGILEX_NGSPICE=/opt/ngspice/bin/ngspice npm run dev
```

ほかの環境変数は [コマンドと設定](../reference/configuration.md) にまとめてあります。

## 英語の画面で起動する

```bash
npm run dev:en
```

最初に表示する言語が英語になります。どちらで起動しても、画面右上の切り替えで言語を変えられます。

## 次に読むもの

- [最初の回路](first-circuit.md): インバータ 2 段を描いて、シミュレーションとレイアウトまで通します。
