# ライセンス

Agile-X Studio のソースコード（`src/`、`server/`、`scripts/`、`docs/`）は [MIT License](https://github.com/kadomoto-lab/agile-x-studio/blob/main/LICENSE) で公開しています。一緒に使うツールやライブラリには、それぞれのライセンスがあります。

## 使っているソフトウェア

| ソフトウェア | ライセンス | 使い方 |
|---|---|---|
| [ngspice](https://ngspice.sourceforge.io/) | BSD-3-Clause（ほか、配布物を参照） | 別プロセスとして実行（シミュレーション）。利用者が別に入れる |
| [KLayout](https://www.klayout.de/) Python モジュール（`klayout`） | GPL-3.0-or-later | **API サーバとスクリプトが読み込む**（GDS の読み書き、レイアウトのタイル描画）。pip が PyPI から入れる |
| [gdsfactory](https://github.com/gdsfactory/gdsfactory)、[kfactory](https://github.com/gdsfactory/kfactory) | MIT、MIT | API サーバが読み込む（GDS の生成と重ね合わせ） |
| [FastAPI](https://fastapi.tiangolo.com/)、[uvicorn](https://www.uvicorn.org/) | MIT、BSD-3-Clause | API サーバ |
| [React](https://react.dev/)、[Vite](https://vite.dev/) | MIT、MIT | 画面 |
| [@xyflow/react](https://reactflow.dev/) | MIT | ブロック図エディタ |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/)（`@monaco-editor/react`） | MIT | ネットリストエディタ |
| [uPlot](https://github.com/leeoniya/uPlot) | MIT | 波形表示 |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | スタイル |
| [lucide-react](https://lucide.dev/) | ISC | アイコン |

## 配布について { #distribution }

**リポジトリとビルドした画面は MIT License で配布できます。** リポジトリには、GPL のソフトウェアからコピーしたコードは入っていません。レイアウトは API サーバが KLayout で PNG の画像に描き、ブラウザはその画像を並べて表示するだけなので、`npm run build` の出力（`dist/`）にも GPL のコードは入りません（[Undine](https://github.com/kadomoto-lab/undine-eda) と同じ方式）。

**API サーバは KLayout と組み合わせて動きます。** API サーバは GPL-3.0-or-later の `klayout` モジュールを読み込みます（gdsfactory もこのモジュールに依存しています）。このモジュールは pip が PyPI から入れるもので、リポジトリには含みません。MIT License は GPLv3 と両立するので、Agile-X Studio 自身のコードは MIT License のままです。

**API サーバと KLayout を一緒に配布するとき。** コンテナイメージ、VM イメージ、インストーラなどで、API サーバと `klayout` モジュールを一緒に配布する人は、その組み合わせを GPL-3.0 の条件で配布することになり、その条件に従う必要があります。

## Agile-X ゲートアレイのデータ

`public/base.gds`、`public/base_forfab.gds`、`public/spice/z_gabasecell.sp`、`public/fab/` は、[Agile-X](https://www.agile-x.t.u-tokyo.ac.jp/) ゲートアレイのベースとベースセルを表すデータです。
