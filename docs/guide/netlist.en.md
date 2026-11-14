# Netlist

In the **Netlist** tab you edit the circuit directly as a SPICE netlist, in Monaco Editor (the editor of VS Code).

The netlist goes to ngspice unchanged, so anything ngspice accepts works. This page covers the rules specific to
Agile-X Studio.

## Layout of a netlist

A netlist written out from the schematic has these parts, in order:

```spice
* 2-stage inverter (pulse input)          <- line 1: the title

* GA base cell library (z_gabasecell.sp)  <- preamble (subcircuits and models)
.SUBCKT Z__GABASECELL G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS
...
.model PMOSMOD1 PMOS (LEVEL=1 ...)

* --- schematic instances ---             <- the parts
V1 n1 0 PULSE(0 1.8 0 1n 1n 50n 100n)
XU1 n1 n2 VDD 0 INV
XU2 n2 n3 VDD 0 INV

* --- chip I/O pads ---                   <- I/O pad assignments (if any)
* GA_IO IN 0 n1

* power supplies                          <- sources for VDD symbols
VVDD VDD 0 dc 1.8

.tran 10p 500n                            <- the analysis
.end
```

As SPICE requires, **the first line is the title** and is not read as part of the circuit. The schematic's
**Circuit title** is read from this line.

## The preamble { #preamble }

Gate-array parts need the base cell's definitions in the netlist. A netlist written from the schematic includes them;
when you write one by hand, copy them from a sample or from
[`public/spice/z_gabasecell.sp`](https://github.com/kadomoto-lab/agile-x-studio/blob/main/public/spice/z_gabasecell.sp).

| Subcircuit | Pins | On the gate array |
|---|---|---|
| `INV` | `IN OUT VDD VSS` | one base cell |
| `NAND2` | `A B OUT VDD VSS` | one base cell |
| `NOR2` | `A B OUT VDD VSS` | one base cell |
| `Z__GABASECELL` | `G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS` | one base cell (pins connected directly) |
| `NMOS` | `D G S VSS` | not placed (simulation only) |
| `PMOS` | `D G S VDD` | not placed (simulation only) |
| `MOSCAP` | `PLUS MINUS VSS` | not placed (simulation only) |

`INV`, `NAND2` and `NOR2` are all `Z__GABASECELL` with its pins wired differently. The transistors use the LEVEL=1
models `NMOSMOD1` and `PMOSMOD1` (L = 0.18 µm, NMOS W = 64 µm, PMOS W = 87.68 µm), and the base cell's internal nodes
carry 100 fF capacitors.

## Lines placed on the gate array

A layout sync places only the lines that:

- are at the top level (outside `.SUBCKT` … `.ENDS`) and start with `X`;
- end with `INV`, `NAND2`, `NOR2` or `Z__GABASECELL`;
- have as many nets as the subcircuit has pins.

Every other line (sources, R, C, L, `NMOS`, …) is ignored by the layout and used only in simulation. `VDD` and `0`
are the supply nets and connect to the base's VDD / VSS rails.

## I/O pads { #ga-io }

To connect a net to a chip I/O pad, add a comment line of this form:

```spice
* GA_IO IN  <number> <net>
* GA_IO OUT <number> <net>
```

- There are 13 `IN` and 13 `OUT` pads, numbered `0`–`12`. Their positions are in
  [Gate array](../reference/gate-array.md#io-pads).
- To SPICE it is a comment, so it does not affect the simulation.
- In the schematic, the **Input** / **Output** symbols write these lines.

Example: bring `a0` in through input pad 0 and `cout` out through output pad 4:

```spice
* GA_IO IN 0 a0
* GA_IO OUT 4 cout
```

## Analysis commands

The schematic offers `.tran`, `.ac` and `.op`. In the Netlist tab you can use anything else ngspice supports.

| You write | Waveforms | Console |
|---|---|---|
| `.tran 10p 50n` | over time | |
| `.ac dec 10 1 1meg` | magnitude over frequency | |
| `.op` | none (a single point) | |
| `.tran` + `.meas` | over time | the measured values (e.g. `vmax = 9.93e-01 at= 5.00e-03`) |
| `.control` … `.endc` | whatever the block writes with `write <name>.raw` | ngspice's output |

See [Simulation](simulation.md).

## Example: an RC low-pass filter

Circuits without gate-array parts simulate as they are:

```spice
* RC low-pass filter
R1 in out 1k
C1 out 0 1u
V1 in 0 sin(0 1 1k)
.tran 10u 5m
.end
```

This circuit has no gate-array parts, so a layout sync adds no routes.
