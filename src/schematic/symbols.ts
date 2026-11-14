import { Position } from '@xyflow/react'
import type { CircuitNodeData, ComponentKind } from './types'

/**
 * 回路図シンボルの幾何（ノード左上原点、px）。
 *
 * ピン座標・ノード寸法はすべて GRID の倍数に揃える。ノード位置もグリッドに
 * スナップするため、ピン同士が一直線に並び配線が余計に折れない。
 * 描画（SchematicSymbol.tsx）・配線（wireRouting.ts）・自動配置
 * （netlistToSchematic.ts）がこの定義を共有する。
 */
export const GRID = 10

export type PinGeom = {
  x: number
  y: number
  /** ピンから配線が出ていく向き */
  dir: Position
}

export type Rect = { x: number; y: number; w: number; h: number }

/** ピンはすべて外形（width × height）の辺上に置く。配線は外形の内側を通らない。 */
export type SymbolGeom = {
  width: number
  height: number
  pins: Record<string, PinGeom>
}

const L = Position.Left
const R = Position.Right
const T = Position.Top
const B = Position.Bottom

/** ラベル文字（9px 等幅）の 1 文字幅 */
export const LABEL_CHAR_W = 5.4

/** 電源シンボル横に表示する値の最大文字数（超過分は … で省略） */
export const SOURCE_VALUE_CHARS = 18

const TWO_TERMINAL: SymbolGeom = {
  width: 60,
  height: 40,
  pins: { a: { x: 0, y: 20, dir: L }, b: { x: 60, y: 20, dir: R } },
}

/** 電圧源・電流源（縦置き、+ が上） */
const SOURCE: SymbolGeom = {
  width: 40,
  height: 60,
  pins: { a: { x: 20, y: 0, dir: T }, b: { x: 20, y: 60, dir: B } },
}

const INV: SymbolGeom = {
  width: 80,
  height: 60,
  pins: {
    in: { x: 0, y: 30, dir: L },
    out: { x: 80, y: 30, dir: R },
    vdd: { x: 40, y: 0, dir: T },
    vss: { x: 40, y: 60, dir: B },
  },
}

const GATE2: SymbolGeom = {
  width: 80,
  height: 60,
  pins: {
    a: { x: 0, y: 20, dir: L },
    b: { x: 0, y: 40, dir: L },
    out: { x: 80, y: 30, dir: R },
    vdd: { x: 40, y: 0, dir: T },
    vss: { x: 40, y: 60, dir: B },
  },
}

const NMOS: SymbolGeom = {
  width: 60,
  height: 60,
  pins: {
    d: { x: 40, y: 0, dir: T },
    g: { x: 0, y: 30, dir: L },
    s: { x: 40, y: 60, dir: B },
    bulk: { x: 60, y: 30, dir: R },
  },
}

/** PMOS はソースを上（VDD 側）に置く */
const PMOS: SymbolGeom = {
  ...NMOS,
  pins: { ...NMOS.pins, s: NMOS.pins.d, d: NMOS.pins.s },
}

const MOSCAP: SymbolGeom = {
  width: 60,
  height: 60,
  pins: {
    plus: { x: 0, y: 30, dir: L },
    minus: { x: 60, y: 30, dir: R },
    vss: { x: 30, y: 60, dir: B },
  },
}

const GABASECELL: SymbolGeom = {
  width: 100,
  height: 140,
  pins: {
    g1: { x: 0, y: 60, dir: L },
    g2: { x: 0, y: 80, dir: L },
    p1: { x: 100, y: 40, dir: R },
    p3: { x: 100, y: 60, dir: R },
    n1: { x: 100, y: 80, dir: R },
    n3: { x: 100, y: 100, dir: R },
    p2: { x: 40, y: 0, dir: T },
    vdd: { x: 60, y: 0, dir: T },
    n2: { x: 40, y: 140, dir: B },
    vss: { x: 60, y: 140, dir: B },
  },
}

const GROUND: SymbolGeom = {
  width: 20,
  height: 20,
  pins: { pin: { x: 10, y: 0, dir: T } },
}

const VDD: SymbolGeom = {
  width: 20,
  height: 30,
  pins: { pin: { x: 10, y: 30, dir: B } },
}

const FIXED: Partial<Record<ComponentKind, SymbolGeom>> = {
  resistor: TWO_TERMINAL,
  capacitor: TWO_TERMINAL,
  inductor: TWO_TERMINAL,
  voltage_dc: SOURCE,
  voltage_sin: SOURCE,
  voltage_pulse: SOURCE,
  voltage_ac: SOURCE,
  current_dc: SOURCE,
  inv: INV,
  nand2: GATE2,
  nor2: GATE2,
  nmos: NMOS,
  pmos: PMOS,
  moscap: MOSCAP,
  gabasecell: GABASECELL,
  ground: GROUND,
  vdd: VDD,
}

export function snapToGrid(v: number): number {
  return Math.round(v / GRID) * GRID
}

function ceilToGrid(v: number): number {
  return Math.ceil(v / GRID) * GRID
}

export function netLabelText(data: CircuitNodeData): string {
  return data.netName ?? data.value
}

export function ioPadText(data: CircuitNodeData): string {
  return `ga_${data.kind === 'ga_io_in' ? 'in' : 'out'}[${data.padIndex ?? 0}]`
}

/** 旗形タグ（ネットラベル・I/O パッド）。尖った側にピンを置く。 */
function tagGeom(text: string, pinSide: 'left' | 'right', minWidth: number): SymbolGeom {
  const width = Math.max(minWidth, ceilToGrid(16 + text.length * LABEL_CHAR_W))
  const pin =
    pinSide === 'left'
      ? { x: 0, y: 10, dir: L }
      : { x: width, y: 10, dir: R }
  return {
    width,
    height: 20,
    pins: { pin },
  }
}

export function symbolGeom(data: CircuitNodeData): SymbolGeom {
  switch (data.kind) {
    case 'net_label':
      return tagGeom(netLabelText(data), data.flip ? 'right' : 'left', 30)
    case 'ga_io_in':
      return tagGeom(ioPadText(data), 'right', 60)
    case 'ga_io_out':
      return tagGeom(ioPadText(data), 'left', 60)
    default:
      return FIXED[data.kind]!
  }
}
