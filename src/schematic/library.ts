import type { ComponentKind, LibraryItem } from './types'
import { SPICE_SUBCKT_NAMES } from './spice/gabasecell'

const TWO_PIN: LibraryItem['pins'] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
]

/** Voltage sources: + (a) on top, − (b) at the bottom */
const VSOURCE_PINS: LibraryItem['pins'] = [
  { id: 'a', label: '+' },
  { id: 'b', label: '−' },
]

const INV_PINS: LibraryItem['pins'] = [
  { id: 'in', label: 'IN' },
  { id: 'out', label: 'OUT' },
  { id: 'vdd', label: 'VDD' },
  { id: 'vss', label: 'VSS' },
]

const AB_OUT_PINS: LibraryItem['pins'] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'out', label: 'OUT' },
  { id: 'vdd', label: 'VDD' },
  { id: 'vss', label: 'VSS' },
]

const MOS_PINS: LibraryItem['pins'] = [
  { id: 'd', label: 'D' },
  { id: 'g', label: 'G' },
  { id: 's', label: 'S' },
  { id: 'bulk', label: 'B' },
]

const MOSCAP_PINS: LibraryItem['pins'] = [
  { id: 'plus', label: '+' },
  { id: 'minus', label: '−' },
  { id: 'vss', label: 'VSS' },
]

const GABASECELL_PINS: LibraryItem['pins'] = [
  { id: 'g1', label: 'G1' },
  { id: 'g2', label: 'G2' },
  { id: 'n1', label: 'N1' },
  { id: 'n2', label: 'N2' },
  { id: 'n3', label: 'N3' },
  { id: 'p1', label: 'P1' },
  { id: 'p2', label: 'P2' },
  { id: 'p3', label: 'P3' },
  { id: 'vdd', label: 'VDD' },
  { id: 'vss', label: 'VSS' },
]

export const COMPONENT_LIBRARY: LibraryItem[] = [
  {
    kind: 'resistor',
    label: 'Resistor',
    shortLabel: 'R',
    category: 'passive',
    defaultValue: '1k',
    description: '2-terminal resistor',
    spicePrefix: 'R',
    pins: TWO_PIN,
  },
  {
    kind: 'capacitor',
    label: 'Capacitor',
    shortLabel: 'C',
    category: 'passive',
    defaultValue: '1u',
    description: '2-terminal capacitor',
    spicePrefix: 'C',
    pins: TWO_PIN,
  },
  {
    kind: 'inductor',
    label: 'Inductor',
    shortLabel: 'L',
    category: 'passive',
    defaultValue: '1m',
    description: '2-terminal inductor',
    spicePrefix: 'L',
    pins: TWO_PIN,
  },
  {
    kind: 'voltage_dc',
    label: 'V source (DC)',
    shortLabel: 'V',
    category: 'source',
    defaultValue: '1',
    description: 'DC voltage source',
    spicePrefix: 'V',
    pins: VSOURCE_PINS,
  },
  {
    kind: 'voltage_sin',
    label: 'V source (sin)',
    shortLabel: 'V~',
    category: 'source',
    defaultValue: 'sin(0 1 1k)',
    description: 'Sinusoidal voltage source',
    spicePrefix: 'V',
    pins: VSOURCE_PINS,
  },
  {
    kind: 'voltage_pulse',
    label: 'V source (pulse)',
    shortLabel: 'V□',
    category: 'source',
    defaultValue: 'PULSE(0 1.8 0 1n 1n 0.5u 1u)',
    description: 'Rectangular pulse: 0–1.8 V, ~1 MHz (50% duty)',
    spicePrefix: 'V',
    pins: VSOURCE_PINS,
  },
  {
    kind: 'voltage_ac',
    label: 'V source (AC)',
    shortLabel: 'Vac',
    category: 'source',
    defaultValue: 'ac 1',
    description: 'AC small-signal source',
    spicePrefix: 'V',
    pins: VSOURCE_PINS,
  },
  {
    kind: 'current_dc',
    label: 'I source (DC)',
    shortLabel: 'I',
    category: 'source',
    defaultValue: 'dc 1m',
    description: 'DC current source',
    spicePrefix: 'I',
    pins: TWO_PIN,
  },
  {
    kind: 'inv',
    label: 'Inverter',
    shortLabel: 'INV',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.inv,
    description: 'INV from Z__GABASECELL (G1=G2=IN)',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.inv,
    spiceTemplate: 'X{ref} {in} {out} {vdd} {vss} INV',
    pins: INV_PINS,
  },
  {
    kind: 'nand2',
    label: 'NAND2',
    shortLabel: 'NAND',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.nand2,
    description: 'NAND2 direct Z__GABASECELL (G1=A, G2=B)',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.nand2,
    spiceTemplate: 'X{ref} {a} {b} {out} {vdd} {vss} NAND2',
    pins: AB_OUT_PINS,
  },
  {
    kind: 'nor2',
    label: 'NOR2',
    shortLabel: 'NOR',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.nor2,
    description: 'NOR2 direct Z__GABASECELL (G1=A, G2=B; P2=_NOR2_PMID internal)',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.nor2,
    spiceTemplate: 'X{ref} {a} {b} {out} {vdd} {vss} NOR2',
    pins: AB_OUT_PINS,
  },
  {
    kind: 'nmos',
    label: 'NMOS',
    shortLabel: 'NMOS',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.nmos,
    description: 'Single NMOS (L=0.18u W=64u, NMOSMOD1)',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.nmos,
    spiceTemplate: 'X{ref} {d} {g} {s} {bulk} NMOS',
    pins: MOS_PINS,
  },
  {
    kind: 'pmos',
    label: 'PMOS',
    shortLabel: 'PMOS',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.pmos,
    description: 'Single PMOS (L=0.18u W=87.68u, PMOSMOD1)',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.pmos,
    spiceTemplate: 'X{ref} {d} {g} {s} {bulk} PMOS',
    pins: MOS_PINS,
  },
  {
    kind: 'moscap',
    label: 'MOS Cap',
    shortLabel: 'MCAP',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.moscap,
    description: 'Gate-connected NMOS + 100f (MOSCAP)',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.moscap,
    spiceTemplate: 'X{ref} {plus} {minus} {vss} MOSCAP',
    pins: MOSCAP_PINS,
  },
  {
    kind: 'gabasecell',
    label: 'GA Base Cell',
    shortLabel: 'GA',
    category: 'digital',
    defaultValue: SPICE_SUBCKT_NAMES.base,
    description: 'Raw Z__GABASECELL subcircuit',
    spicePrefix: 'U',
    spiceSubckt: SPICE_SUBCKT_NAMES.base,
    spiceTemplate:
      'X{ref} {g1} {g2} {n1} {n2} {n3} {p1} {p2} {p3} {vdd} {vss} Z__GABASECELL',
    pins: GABASECELL_PINS,
  },
  {
    kind: 'ground',
    label: 'Ground',
    shortLabel: 'GND',
    category: 'other',
    defaultValue: '0',
    description: 'Reference net (0)',
    spicePrefix: '',
    pins: [{ id: 'pin', label: 'GND' }],
  },
  {
    kind: 'vdd',
    label: 'VDD',
    shortLabel: 'VDD',
    category: 'other',
    defaultValue: '1.8',
    description: '1.8 V power supply (VDD net)',
    spicePrefix: 'V',
    spiceTemplate: 'V{ref} VDD 0 dc {value}',
    pins: [{ id: 'pin', label: 'VDD' }],
  },
  {
    kind: 'net_label',
    label: 'Net label',
    shortLabel: 'Net',
    category: 'other',
    defaultValue: 'net1',
    description: 'Name a wire/net',
    spicePrefix: '',
    pins: [{ id: 'pin', label: 'Net' }],
  },
  {
    kind: 'ga_io_in',
    label: 'Input',
    shortLabel: 'IN',
    category: 'other',
    defaultValue: '0',
    description: 'Chip I/O input pad (ga_in[0–12])',
    spicePrefix: 'IOI',
    pins: [{ id: 'pin', label: 'SIG' }],
  },
  {
    kind: 'ga_io_out',
    label: 'Output',
    shortLabel: 'OUT',
    category: 'other',
    defaultValue: '0',
    description: 'Chip I/O output pad (ga_out[0–12])',
    spicePrefix: 'IOO',
    pins: [{ id: 'pin', label: 'SIG' }],
  },
]

export function getLibraryItem(kind: ComponentKind): LibraryItem {
  const item = COMPONENT_LIBRARY.find((c) => c.kind === kind)
  if (!item) throw new Error(`Unknown component: ${kind}`)
  return item
}

export function getPinIds(kind: ComponentKind): string[] {
  return getLibraryItem(kind).pins.map((p) => p.id)
}

export function isDigitalKind(kind: ComponentKind): boolean {
  return getLibraryItem(kind).category === 'digital'
}
