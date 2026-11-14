# コマンドと設定

## npm スクリプト

Python を使うスクリプトは `uv run` を通して、`uv sync` で作った `.venv` の中で動きます。venv を有効にする必要はありません。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 画面（Vite、5173）と API サーバ（8000）を同時に起動。最初の言語は日本語 |
| `npm run dev:en` | 同上。最初の言語は英語 |
| `npm run dev:vite` | 画面だけを起動 |
| `npm run dev:api` | API サーバだけを起動（`uv run uvicorn --reload`、`127.0.0.1:8000`） |
| `npm run build` | 日本語を既定にしたビルドを `dist/` に作る（`build:ja` と同じ） |
| `npm run build:en` | 英語を既定にしたビルドを `dist-en/` に作る |
| `npm run build:all` | 両方を作る |
| `npm run preview` / `preview:en` | ビルドしたものをプレビューする |
| `npm run lint` | ESLint |
| `npm run export:fab` | `base.gds` から `public/fab/gate-array.json` を作る |
| `npm run test:ga` | 配置・配線のテスト（`server/test_ga_layout.py`） |
| `npm run docs:serve` | ドキュメントサイトをローカルで表示（<http://127.0.0.1:8001>） |
| `npm run docs:build` | ドキュメントサイトを `site/` に作る（リンク切れがあると失敗） |

Python の依存パッケージを足すときは `uv add <パッケージ>`、ドキュメント用なら `uv add --group docs <パッケージ>` を使います。`pyproject.toml` と `uv.lock` が更新されるので、両方をコミットしてください。

`dev`・`build` は、始める前に `export:fab` を自動で実行します。

!!! note "ビルドしたものの配信"
    `dist/` は画面だけです。シミュレーションとレイアウトには API サーバが必要で、同じオリジンの `/api` に届くよう、リバースプロキシなどで API サーバへ中継してください。

## 環境変数

### API サーバ

| 変数 | 既定値 | 内容 |
|---|---|---|
| `AGILEX_NGSPICE` | | 使う ngspice の実行ファイル。指定するとほかの場所は探さない |
| `UNDINE_TOOLS` | | `$UNDINE_TOOLS/bin` から ngspice を探す |
| `AGILEX_SIM_TIMEOUT` | `120` | シミュレーションのタイムアウト（秒） |
| `AGILEX_SIM_MAX_POINTS` | `8000` | 波形として返す最大点数 |

ngspice を探す順番は [インストール](../getting-started/install.md#ngspice-location) を参照してください。

### 画面

| 変数 | 既定値 | 内容 |
|---|---|---|
| `VITE_LOCALE` | `ja` | 最初に表示する言語（`ja` / `en`）。ビルドの出力先（`dist/` / `dist-en/`）も決める |

## ファイル

| パス | 内容 | git |
|---|---|---|
| `pyproject.toml` | Python の依存パッケージ（`docs` グループはドキュメント用） | 管理 |
| `uv.lock` | 依存パッケージの版の固定 | 管理 |
| `.venv/` | `uv sync` で作る Python 環境 | 対象外 |
| `public/base.gds` | ゲートアレイのベース | 管理 |
| `public/base_forfab.gds` | 製造用のベース（原点がチップ中央） | 管理 |
| `public/spice/z_gabasecell.sp` | ベースセルのサブサーキットとモデル | 管理 |
| `public/fab/gate-array.json` | ゲートアレイの寸法（`export:fab` で作る） | 管理 |
| `public/fab/primitives.json` | ゲートとピンの対応 | 管理 |
| `server/data/layers.lyp` | レイアウト表示の層の色（KLayout のレイヤ設定） | 管理 |
| `public/generated/` | 同期で作った GDS | 対象外 |
