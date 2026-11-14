import type { Edge, Node } from '@xyflow/react'

export type ComponentKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'voltage_dc'
  | 'voltage_sin'
  | 'voltage_pulse'
  | 'voltage_ac'
  | 'current_dc'
  | 'ground'
  | 'vdd'
  | 'net_label'
  | 'ga_io_in'
  | 'ga_io_out'
  | 'inv'
  | 'nand2'
  | 'nor2'
  | 'nmos'
  | 'pmos'
  | 'moscap'
  | 'gabasecell'

export type CircuitNodeData = {
  kind: ComponentKind
  ref: string
  value: string
  /** net_label 用 */
  netName?: string
  /** ga_io_in / ga_io_out 用: 0–12 */
  padIndex?: number
  /** net_label 用: true でピンを右側に置く（左向きに読むラベル） */
  flip?: boolean
}

export type CircuitNode = Node<CircuitNodeData, ComponentKind>

export type CircuitEdge = Edge

export type AnalysisType = 'tran' | 'ac' | 'op'

export type SchematicDocument = {
  title: string
  nodes: CircuitNode[]
  edges: CircuitEdge[]
  analysis: {
    type: AnalysisType
    params: string
  }
}

/** ピンの並び・表示名。座標と向きは schematic/symbols.ts で定義する。 */
export type PinDef = {
  id: string
  label: string
}

export type LibraryCategory = 'passive' | 'source' | 'digital' | 'other'

export type LibraryItem = {
  kind: ComponentKind
  label: string
  shortLabel: string
  category: LibraryCategory
  defaultValue: string
  description: string
  /** SPICE element prefix (X for subcircuits) */
  spicePrefix: string
  /** Ordered pin list for netlist + schematic handles */
  pins: PinDef[]
  /** Subcircuit name emitted in netlist (digital cells) */
  spiceSubckt?: string
  /** Human-readable SPICE template shown in property panel */
  spiceTemplate?: string
}
