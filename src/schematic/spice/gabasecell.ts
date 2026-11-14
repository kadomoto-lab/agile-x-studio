/** SPICE subcircuit names and netlist fragments for GA base-cell library.
 *
 * INV / NOR2 / NAND2 の X_BC 行は public/fab/primitives.json の
 * gates[].spiceLine と一致させる（レイアウト pinMap / metal5Ties の正本）。
 */

export const SPICE_SUBCKT_NAMES = {
  base: 'Z__GABASECELL',
  inv: 'INV',
  nand2: 'NAND2',
  nor2: 'NOR2',
  nmos: 'NMOS',
  pmos: 'PMOS',
  moscap: 'MOSCAP',
} as const

/** Prepended once per generated netlist (models + subcircuit definitions). */
export const SPICE_PREAMBLE = `* GA base cell library (z_gabasecell.sp)

.SUBCKT Z__GABASECELL G1 G2 N1 N2 N3 P1 P2 P3 VDD VSS
MP1 P3 G1 P2 VDD PMOSMOD1 L=0.18u W=87.68u M=1
MP2 P1 G2 P2 VDD PMOSMOD1 L=0.18u W=87.68u M=1
MN1 N3 G1 N2 VSS NMOSMOD1 L=0.18u W=64u    M=1
MN2 N1 G2 N2 VSS NMOSMOD1 L=0.18u W=64u    M=1
C1 N1 0 100f
C2 N2 0 100f
C3 P1 0 100f
C4 P2 0 100f
.ENDS

.SUBCKT INV IN OUT VDD VSS
X_BC IN IN OUT VSS OUT OUT VDD OUT VDD VSS Z__GABASECELL
.ENDS

.SUBCKT NOR2 A B OUT VDD VSS
X_BC A B OUT VSS OUT OUT _NOR2_PMID VDD VDD VSS Z__GABASECELL
.ENDS

.SUBCKT NAND2 A B OUT VDD VSS
X_BC A B OUT _NAND2_NMID VSS OUT VDD OUT VDD VSS Z__GABASECELL
.ENDS

.SUBCKT NMOS D G S VSS
MN1 D G S VSS NMOSMOD1 L=0.18u W=64u M=1
.ENDS

.SUBCKT PMOS D G S VDD
MP1 D G S VDD PMOSMOD1 L=0.18u W=87.68u M=1
.ENDS

.SUBCKT MOSCAP PLUS MINUS VSS
MN1 PLUS MINUS MINUS VSS NMOSMOD1 L=0.18u W=64u M=1
C1 PLUS MINUS 100f
.ENDS

.model NMOSMOD1 NMOS (LEVEL=1 VTO=0.5 KP=120u LAMBDA=0.02 GAMMA=0.4 PHI=0.6)
.model PMOSMOD1 PMOS (LEVEL=1 VTO=-0.5 KP=40u LAMBDA=0.02 GAMMA=0.4 PHI=0.6)
`

export function spiceInstance(
  ref: string,
  subckt: string,
  nets: string[],
): string {
  return `X${ref} ${nets.join(' ')} ${subckt}`
}
