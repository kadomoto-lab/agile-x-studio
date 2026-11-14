# アーキテクチャと開発

Agile-X Studio の中身と、手を入れるときの決まりです。使い方は [ユーザーガイド](guide/schematic.md) を参照してください。

## 構成

```text
ブラウザ (React 19 + Vite + TypeScript)
  ├─ ブロック図          @xyflow/react
  ├─ ネットリスト        Monaco Editor
  ├─ 波形                uPlot
  └─ レイアウト          canvas（サーバで描いたタイルを並べる）
        │  /api（開発時は Vite が 127.0.0.1:8000 へ中継）
        ▼
API サーバ (FastAPI + uvicorn)
  ├─ /api/simulate      → server/spice.py  → ngspice（別プロセス、バッチ）
  ├─ /api/layout/sync   → server/layout.py → server/ga_*.py（配置・配線・検証）
  │                                         → gdsfactory / KLayout で GDS を書き出す
  └─ /api/layout/tile   → server/layout_view.py → KLayout の LayoutView で PNG を描く
```

- ブラウザに配るのは画面のコードと画像だけです。KLayout（GPL）はサーバ側の Python モジュールとしてだけ使います（[ライセンス](licenses.md#distribution)）。
- 回路の状態（ブロック図、ネットリスト、取り消し履歴）はブラウザだけが持ちます。API サーバは状態を持たず、リクエストごとにネットリストを受け取って結果を返します。生成した GDS だけは `public/generated/` に書きます。
- ブロック図とネットリストの変換はブラウザ側（`src/schematic/`）で行います。

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/App.tsx` | 画面全体、シミュレーションの実行 |
| `src/hooks/useCircuitProject.ts` | 回路の状態、取り消し履歴、ブロック図とネットリストの同期 |
| `src/components/` | 画面の部品（`SchematicEditor`、`WaveformViewer`、`GdsViewer` など） |
| `src/schematic/` | ブロック図のデータ、部品ライブラリ、ネットリストとの相互変換、自動配置、配線経路 |
| `src/samples/circuits.ts` | サンプル回路 |
| `src/lib/` | API の呼び出し（`simulation.ts`、`layoutApi.ts`）、波形の変換、レイアウト表示のタイルとカメラ（`layoutView.ts`） |
| `src/i18n/` | 画面の文言（`ja.ts` が正本、`en.ts` が翻訳） |
| `server/main.py` | API のエンドポイント |
| `server/spice.py` | ngspice の検出、ネットリストの前処理、実行、`.raw` の読み込み |
| `server/layout.py` | レイアウト同期の入口、GDS の重ね合わせ |
| `server/layout_view.py` | レイアウトのタイル描画（KLayout の LayoutView）、レイヤ一覧、印刷用の画像 |
| `server/ga_netlist.py`、`ga_extract.py` | ネットリストからゲートと接続を取り出す |
| `server/ga_placement.py` | ゲートアレイへの配置 |
| `server/ga_grid_router.py` | 10 µm 格子の A* 配線（ジャンパ、取り消し可能な塗りつぶし） |
| `server/ga_global_route.py`、`ga_jumper_climb.py`、`ga_channel_router.py` | 行をまたぐ配線、ジャンパの登録、構造的な配線 |
| `server/ga_io_pads.py` | I/O パッドの座標と配線 |
| `server/ga_sync.py` | 配置 → 配線 → 検証 → 出力の流れと、やり直し |
| `server/ga_verify.py` | 出力図形からの独立した検証（ショート・オープン・間隔） |
| `server/ga_overlay.py` | 配線とラベルの GDS 出力 |
| `server/data/layers.lyp` | レイアウト表示の層の色 |
| `scripts/` | `gate-array.json` の生成 |
| `public/` | ベースの GDS、ゲートアレイの情報、SPICE ライブラリ |
| `docs/` | このドキュメント（MkDocs） |
| `pyproject.toml`、`uv.lock` | Python の依存パッケージと、その版の固定（[uv](https://docs.astral.sh/uv/)） |

## チェック

変更したら、次を通してください。

```bash
npx tsc -b                       # 型チェック
npm run lint                     # ESLint
npm run test:ga                  # 配置・配線のテスト（uv run python server/test_ga_layout.py）
npm run build                    # ビルド
```

`server/test_ga_layout.py` は、INV の連鎖、NAND2 との混在、I/O パッド、2〜3 行にまたがるリングオシレータ・ファンアウト・ランダム結線などを同期し、検証が通ることを確かめます。また、検証器がショートとオープンを見つけられることも確かめます。数十秒かかります。テストは `public/generated/test_*.gds` を書き出します（git の対象外）。

配置・配線（`server/ga_*.py`）を変えたときは、必ずこのテストを実行してください。

## 画面の文言（i18n）

| 項目 | 決まり |
|---|---|
| 正本 | 日本語 |
| 文言の置き場所 | `src/i18n/ja.ts`（正本）、`src/i18n/en.ts`（翻訳）、型は `src/i18n/types.ts` |
| コードのコメント | 日本語のまま（翻訳しない） |
| 切り替え | 実行時（ヘッダ右上）。選択は localStorage に保存 |
| 最初の言語 | 保存された選択 → `VITE_LOCALE`（未設定なら `ja`） |

コンポーネントは `import { messages } from '../i18n'` で文言を読み、画面の文字列を直接書きません。

- `messages` は `setLocale()` で差し替わる ES モジュールのライブバインディングです。描画のとき（JSX の中やイベントハンドラ）に `messages.…` を読み、モジュールの先頭や `useMemo` で文字列を固定しないでください。
- `App` は `useLocale()` で再描画します。`memo` したコンポーネントで文言を使うときは、そのコンポーネントでも `useLocale()` を呼びます。
- 文言を含む計算結果（波形の軸ラベルなど）は、言語を依存に入れて計算し直します。

### 文言を足す

1. `src/i18n/types.ts` にキーを足す
2. `src/i18n/ja.ts` に日本語を書く
3. `src/i18n/en.ts` に英語を書く
4. コンポーネントから `messages.…` で読む

2 つの言語でキーがずれると `tsc` が失敗するので、書き漏れはビルドの前に分かります。

部品名（Resistor、INV など）、SPICE やファイル名、サーバ側のログとコメントは翻訳の対象外です。

## ドキュメント

ドキュメントは [MkDocs](https://www.mkdocs.org/) と [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) で作ります。日本語が正本で、`page.md` が日本語、`page.en.md` が英語です（[mkdocs-static-i18n](https://github.com/ultrabug/mkdocs-static-i18n)）。

```bash
npm run docs:serve   # http://127.0.0.1:8001（uv run --only-group docs mkdocs serve）
npm run docs:build   # site/ に作る（uv run --only-group docs mkdocs build --strict）
```

`main` ブランチへの push で、GitHub Actions（`.github/workflows/docs.yml`）がサイトを作り、GitHub Pages に公開します。

ページを足したり変えたりするときは、日本語と英語の両方を更新してください。画面の説明は、画面の文言（`src/i18n/`）と同じ言葉を使います。スクリーンショットは `docs/images/ja/` と `docs/images/en/` に、それぞれの言語の画面で撮ったものを置きます。
