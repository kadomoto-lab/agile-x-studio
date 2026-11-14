# Gate array

The dimensions and structure of the [Agile-X](https://www.agile-x.t.u-tokyo.ac.jp/en/) gate array that Agile-X Studio places and routes on. All values are read
from `base.gds` by [`scripts/export_gate_array.py`](https://github.com/kadomoto-lab/agile-x-studio/blob/main/scripts/export_gate_array.py)
into `public/fab/gate-array.json` (`npm run export:fab`, run automatically before `npm run dev`). Coordinates are in
µm with the origin at the bottom-left of the chip.

## The chip

| Item | Value |
|---|---|
| Chip size | 5800 × 4990 |
| Base cell | `Z__GABASECELL`, 160 × 150 |
| Array | 9 rows × 35 columns = 315 cells |
| Bottom-left of the first cell | (100, 100) |
| Pitch | 160 horizontal, 580 vertical (a 430 gap between rows) |
| Bottom-left of the cell in row *r*, column *c* | (100 + 160*c*, 100 + 580*r*) |
| Layers | METAL4 (31/0), VIA45 (32/0), METAL5 (33/0) |

`base_forfab.gds` is the fabrication base, with its origin at the center of the chip (offset by (−2900, −2900) from
`base.gds`).

## The base cell

A base cell holds two PMOS and two NMOS transistors, whose terminals come out as eight METAL5 pins.

```spice
.SUBCKT Z__GABASECELL G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS
MP1 P3 G1 P2 VDD PMOSMOD1 L=0.18u W=87.68u
MP2 P1 G2 P2 VDD PMOSMOD1 L=0.18u W=87.68u
MN1 N3 G1 N2 VSS NMOSMOD1 L=0.18u W=64u
MN2 N1 G2 N2 VSS NMOSMOD1 L=0.18u W=64u
.ENDS
```

### Pins

Each pin is a column of six terminal pads connected in lower metal, so a route can use any of them.

| Pin | P3 | P2 | P1 | G1 | G2 | N3 | N2 | N1 |
|---|---|---|---|---|---|---|---|---|
| X in the cell | 45 | 55 | 65 | 75 | 85 | 95 | 105 | 115 |

| Y in the cell | Use |
|---|---|
| 5, 145 | the bottom and top ends of the cell; routes between rows and to the I/O pads leave from here |
| 15 | the VSS rail (across the whole row) |
| 25, 65, 85, 125 | routing tracks inside the row |
| 135 | the VDD rail (across the whole row) |

### Gates and pins

| Gate | G1 | G2 | N1 | N2 | N3 | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|
| `INV` | IN | IN | OUT | VSS | OUT | OUT | VDD | OUT |
| `NAND2` | A | B | OUT | (internal) | VSS | OUT | VDD | OUT |
| `NOR2` | A | B | OUT | VSS | OUT | OUT | (internal) | VDD |

"Internal" is a node used only inside that gate (`_NAND2_NMID`, `_NOR2_PMID`).

## Routing { #routing }

| Item | Value |
|---|---|
| Routing layer | METAL5 |
| Wire width | 5 |
| Routing grid | 10 |
| Minimum spacing between different nets (verification) | 5 |

## Jumpers { #jumpers }

Lower-metal jumpers let a route pass over METAL5 wires. Each end is a 5 × 5 METAL5 pad.

| Jumper | Count | Where | Pads |
|---|---|---|---|
| `ga_top_JUMPLINE2_M4` | 2520 (315 cells × 8) | in each cell at X = 5, 15, 25, 35, 125, 135, 145, 155 | Y = 5 and 145 in the cell |
| `ga_top_JUMPLINE1_M4` | 15680 (8 gaps × 280 columns × 7) | in the gaps between rows, X = 105 + 20*k* (*k* = 0–279) | Y = 265 + 60*j* + 580*r* and 40 above it (*j* = 0–6, *r* = 0–7) |

## I/O pads { #io-pads }

The right edge of the chip (X = 5797) has 13 input and 13 output pads. The numbers in `GA_IO` lines are the numbers in
this table.

| Number | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `IN` Y | 2315 | 2655 | 2735 | 2815 | 2895 | 3235 | 3315 | 3395 | 3475 | 3815 | 3895 | 3975 | 4055 |
| `OUT` Y | 335 | 415 | 915 | 995 | 1075 | 1155 | 1495 | 1575 | 1655 | 1735 | 2075 | 2155 | 2235 |

I/O routes use the same grid as other routes up to X = 5700, and run straight to the pad from there.
