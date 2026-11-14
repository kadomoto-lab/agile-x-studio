# ネットリスト

**ネットリスト** タブでは、回路を SPICE ネットリストのテキストで直接編集します。エディタは Monaco Editor（VS Code と同じエディタ）です。

ネットリストは ngspice にそのまま渡されるので、ngspice が受け付ける書き方はすべて使えます。このページでは、Agile-X Studio に特有の決まりを説明します。

## ネットリストの構成

ブロック図から書き出したネットリストは、次の順に並びます。

```spice
* 2-stage inverter (pulse input)          ← 1 行目: タイトル

* GA base cell library (z_gabasecell.sp)  ← プリアンブル（サブサーキットとモデル）
.SUBCKT Z__GABASECELL G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS
...
.model PMOSMOD1 PMOS (LEVEL=1 ...)

* --- schematic instances ---             ← 部品
V1 n1 0 PULSE(0 1.8 0 1n 1n 50n 100n)
XU1 n1 n2 VDD 0 INV
XU2 n2 n3 VDD 0 INV

* --- chip I/O pads ---                   ← I/O パッドの割り当て（あれば）
* GA_IO IN 0 n1

* power supplies                          ← VDD 記号の電源
VVDD VDD 0 dc 1.8

.tran 10p 500n                            ← 解析
.end
```

SPICE の決まりどおり、**1 行目はタイトル** として扱われ、回路としては読まれません。ブロック図の **回路タイトル** もこの行から読み取ります。

## プリアンブル { #preamble }

ゲートアレイの部品を使うには、ネットリストにベースセルの定義が必要です。ブロック図から書き出すと自動で入ります。手で書くときは、サンプルからコピーするか [`public/spice/z_gabasecell.sp`](https://github.com/kadomoto-lab/agile-x-studio/blob/main/public/spice/z_gabasecell.sp) を参照してください。

| サブサーキット | ピン | ゲートアレイ |
|---|---|---|
| `INV` | `IN OUT VDD VSS` | ベースセル 1 個 |
| `NAND2` | `A B OUT VDD VSS` | ベースセル 1 個 |
| `NOR2` | `A B OUT VDD VSS` | ベースセル 1 個 |
| `Z__GABASECELL` | `G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS` | ベースセル 1 個（ピンを直接つなぐ） |
| `NMOS` | `D G S VSS` | 置かない（シミュレーションのみ） |
| `PMOS` | `D G S VDD` | 置かない（シミュレーションのみ） |
| `MOSCAP` | `PLUS MINUS VSS` | 置かない（シミュレーションのみ） |

`INV`・`NAND2`・`NOR2` は、どれも `Z__GABASECELL` のピンのつなぎ方を変えたものです。トランジスタは `NMOSMOD1`・`PMOSMOD1` の LEVEL=1 モデル（L = 0.18 µm、NMOS の W = 64 µm、PMOS の W = 87.68 µm）で、ベースセルの内部ノードには 100 fF の容量がついています。

## ゲートアレイに置かれる行

レイアウトの同期では、ネットリストの中から次の条件を満たす行だけを取り出して配置します。

- トップレベル（`.SUBCKT` 〜 `.ENDS` の外）にある `X` で始まる行
- 最後の語が `INV`・`NAND2`・`NOR2`・`Z__GABASECELL` のどれか
- ネットの数が、そのサブサーキットのピンの数と同じ

それ以外の行（電源、R・C・L、`NMOS` など）はレイアウトでは無視され、シミュレーションにだけ使われます。`VDD` と `0` は電源ネットとして、ベースの VDD / VSS 配線につながります。

## I/O パッド { #ga-io }

ネットをチップの I/O パッドにつなぐには、次の形のコメント行を書きます。

```spice
* GA_IO IN  <番号> <ネット名>
* GA_IO OUT <番号> <ネット名>
```

- `IN` と `OUT` のパッドはそれぞれ 13 個あり、番号は `0`〜`12` です。位置は [ゲートアレイ](../reference/gate-array.md#io-pads) を参照してください。
- SPICE ではコメント行なので、シミュレーションには影響しません。
- ブロック図では **Input** / **Output** 記号を置くと、この行が書き出されます。

例: 入力パッド 0 番から `a0` を、出力パッド 4 番から `cout` を出す

```spice
* GA_IO IN 0 a0
* GA_IO OUT 4 cout
```

## 解析コマンド

ブロック図では `.tran`・`.ac`・`.op` を選べます。ネットリストタブでは、ngspice のほかの書き方も使えます。

| 書き方 | 波形 | コンソール |
|---|---|---|
| `.tran 10p 50n` | 時間軸の波形 | |
| `.ac dec 10 1 1meg` | 周波数軸の振幅（絶対値） | |
| `.op` | 出ません（1 点だけのため） | |
| `.tran` + `.meas` | 時間軸の波形 | 測定値（例: `vmax = 9.93e-01 at= 5.00e-03`） |
| `.control` 〜 `.endc` | ブロックの中で `write <名前>.raw` したものを表示 | ngspice の出力 |

詳しくは [シミュレーション](simulation.md) を参照してください。

## 例: RC ローパスフィルタ

ゲートアレイを使わない回路も、そのままシミュレーションできます。

```spice
* RC low-pass filter
R1 in out 1k
C1 out 0 1u
V1 in 0 sin(0 1 1k)
.tran 10u 5m
.end
```

この回路にはゲートアレイの部品がないので、レイアウトを同期しても配線は何も作られません。
