import { Position } from '@xyflow/react'
import type { CircuitEdge, CircuitNode, CircuitNodeData, ComponentKind } from './types'
import { isDigitalKind } from './library'
import { GRID, LABEL_CHAR_W, SOURCE_VALUE_CHARS, symbolGeom, type PinGeom } from './symbols'

/**
 * ネットリスト取り込み時の回路図自動配置（xschem 風）。
 *
 * - 部品を信号の流れ順に左→右へ並べ、行幅を超えたら折り返す
 * - 同じ行で隣り合う部品が共有するネットは直接ワイヤでつなぐ
 * - それ以外のピンには、そのピンのすぐ横にネットラベルを置く
 *   （同名ラベル同士は同一ネット。netlist.ts の resolveNetNames を参照）
 * - VDD / GND (0) は各ピンにローカルな電源・グランド記号を付ける
 *
 * 長い配線を引き回さないので、配線の交差がほとんど生じない。
 */

export type PinRole = 'in' | 'out' | 'io'

export type LayoutPart = {
  node: CircuitNode
  pins: { handle: string; net: string; role: PinRole }[]
}

export type SupplyInfo = { ref: string; value: string }

const GND_NET = '0'
const VDD_NET = 'VDD'
const ROW_MAX_WIDTH = 1600
const MARGIN = 40
const PART_GAP = 30
const ROW_GAP = 40

const SOURCE_KINDS = new Set<ComponentKind>([
  'voltage_dc',
  'voltage_sin',
  'voltage_pulse',
  'voltage_ac',
  'current_dc',
])
const INPUT_HANDLES = new Set(['in', 'a', 'b', 'g', 'g1', 'g2'])
const OUTPUT_HANDLES = new Set(['out', 'd', 'n1', 'n3', 'p1', 'p3'])

const isGlobal = (net: string) => net === GND_NET || net === VDD_NET

export function pinRole(kind: ComponentKind, handle: string): PinRole {
  if (kind === 'ga_io_in') return 'out'
  if (kind === 'ga_io_out') return 'in'
  if (!isDigitalKind(kind) || kind === 'moscap') return 'io'
  if (INPUT_HANDLES.has(handle)) return 'in'
  if (OUTPUT_HANDLES.has(handle)) return 'out'
  return 'io'
}

function signalPins(part: LayoutPart) {
  return part.pins.filter((p) => !isGlobal(p.net))
}

/** 入力パッド・電源 → 未駆動入力の部品 → その他、の順に出力ネットをたどって並べる。 */
function chainOrder(parts: LayoutPart[]): LayoutPart[] {
  const driven = new Set(
    parts.flatMap((p) => signalPins(p).filter((q) => q.role === 'out').map((q) => q.net)),
  )
  const rank = (p: LayoutPart) => {
    const kind = p.node.data.kind
    if (kind === 'ga_io_in') return 0
    if (SOURCE_KINDS.has(kind)) return 1
    return signalPins(p).some((q) => q.role === 'in' && driven.has(q.net)) ? 3 : 2
  }
  const starts = parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p)

  const visited = new Set<LayoutPart>()
  const next = (p: LayoutPart): LayoutPart | undefined => {
    for (const q of signalPins(p)) {
      if (q.role === 'in') continue
      const found = parts.find(
        (o) => !visited.has(o) && signalPins(o).some((r) => r.net === q.net && r.role !== 'out'),
      )
      if (found) return found
    }
    return undefined
  }

  const order: LayoutPart[] = []
  for (const start of starts) {
    let cur: LayoutPart | undefined = start
    while (cur && !visited.has(cur)) {
      visited.add(cur)
      order.push(cur)
      cur = next(cur)
    }
  }
  return order
}

type AttachKind = 'label' | 'label_offset' | 'ground' | 'vdd'

type Attachment = {
  part: LayoutPart
  handle: string
  net: string
  kind: AttachKind
  data: CircuitNodeData
  /** 部品ノード原点からの相対位置 */
  dx: number
  dy: number
  w: number
  h: number
}

/** ピンに付けるラベル・電源記号の位置（ピン位置からの相対、ノード左上）。 */
function placeAttachment(
  pin: PinGeom,
  kind: AttachKind,
  data: CircuitNodeData,
  leftSide = false,
): { x: number; y: number; data: CircuitNodeData } {
  const { x: px, y: py, dir } = pin
  if (kind === 'ground') {
    if (dir === Position.Bottom) return { x: px - 10, y: py + 20, data }
    if (dir === Position.Left) return { x: px - 30, y: py + 20, data }
    return { x: px + 10, y: dir === Position.Top ? py : py + 20, data }
  }
  if (kind === 'vdd') {
    if (dir === Position.Top) return { x: px - 10, y: py - 50, data }
    if (dir === Position.Left) return { x: px - 30, y: py - 50, data }
    return { x: px + 10, y: dir === Position.Bottom ? py - 20 : py - 50, data }
  }
  // ネットラベル: 左向きピンには左へ伸びる（ピンが右側の）ラベルを置く。
  // 上下ピンは右上／右下が既定で、leftSide なら左上／左下
  const flipped = { ...data, flip: true }
  const fw = symbolGeom(flipped).width
  if (dir === Position.Left) {
    return { x: px - 20 - fw, y: kind === 'label' ? py - 10 : py - 30, data: flipped }
  }
  if (dir === Position.Right) return { x: px + 20, y: kind === 'label' ? py - 10 : py - 30, data }
  const y = dir === Position.Top ? py - 30 : py + 10
  return leftSide ? { x: px - 20 - fw, y, data: flipped } : { x: px + 20, y, data }
}

function attachmentData(kind: AttachKind, net: string, supply: SupplyInfo): CircuitNodeData {
  if (kind === 'ground') return { kind: 'ground', ref: 'GND', value: '0' }
  if (kind === 'vdd') return { kind: 'vdd', ref: supply.ref, value: supply.value }
  return { kind: 'net_label', ref: 'NET', value: net, netName: net }
}

function makeAttachment(
  part: LayoutPart,
  handle: string,
  net: string,
  kind: AttachKind,
  supply: SupplyInfo,
  avoid: Attachment[] = [],
): Attachment {
  const pin = symbolGeom(part.node.data).pins[handle]
  const make = (leftSide: boolean): Attachment => {
    const placed = placeAttachment(pin, kind, attachmentData(kind, net, supply), leftSide)
    const g = symbolGeom(placed.data)
    return { part, handle, net, kind, data: placed.data, dx: placed.x, dy: placed.y, w: g.width, h: g.height }
  }
  // 同じ部品に付けた電源記号・ラベルと重なるなら反対側に置く
  const right = make(false)
  if (!avoid.some((o) => overlaps(right, o))) return right
  const left = make(true)
  return avoid.some((o) => overlaps(left, o)) ? right : left
}

function overlaps(a: Attachment, b: Attachment): boolean {
  const m = GRID / 2
  return (
    a.dx < b.dx + b.w + m &&
    b.dx < a.dx + a.w + m &&
    a.dy < b.dy + b.h + m &&
    b.dy < a.dy + a.h + m
  )
}

function globalAttachments(part: LayoutPart, supply: SupplyInfo): Attachment[] {
  return part.pins
    .filter((p) => isGlobal(p.net))
    .map((p) => makeAttachment(part, p.handle, p.net, p.net === GND_NET ? 'ground' : 'vdd', supply))
}

/** 電源シンボル右側の名前・値の文字列が占める幅 */
function textRight(part: LayoutPart): number {
  const { kind, ref, value } = part.node.data
  if (!SOURCE_KINDS.has(kind)) return 0
  return 40 + Math.max(ref.length, Math.min(value.length, SOURCE_VALUE_CHARS)) * LABEL_CHAR_W
}

/** 部品と付属記号を合わせた範囲（部品ノード原点からの相対） */
function extents(part: LayoutPart, attachments: Attachment[]) {
  const g = symbolGeom(part.node.data)
  let x0 = 0
  let y0 = 0
  let x1 = Math.max(g.width, textRight(part))
  let y1 = g.height
  for (const a of attachments) {
    x0 = Math.min(x0, a.dx)
    y0 = Math.min(y0, a.dy - (a.kind === 'vdd' ? 10 : 0))
    x1 = Math.max(x1, a.dx + a.w + (a.kind === 'vdd' ? 20 : 0))
    y1 = Math.max(y1, a.dy + a.h)
  }
  return { x0, y0, x1, y1 }
}

/** 行の基準線に合わせるピンの y（出力ピン → 入力ピン → 左右ピン → 中央） */
function anchorY(part: LayoutPart): number {
  const g = symbolGeom(part.node.data)
  const side = (dir: Position) => dir === Position.Left || dir === Position.Right
  const pick = (role: PinRole) =>
    part.pins.find((p) => p.role === role && !isGlobal(p.net) && side(g.pins[p.handle]?.dir))
  const p = pick('out') ?? pick('in') ?? part.pins.find((q) => side(g.pins[q.handle]?.dir))
  return p ? g.pins[p.handle].y : Math.round(g.height / 2 / GRID) * GRID
}

export function layoutSchematic(
  parts: LayoutPart[],
  supply: SupplyInfo | null,
): { nodes: CircuitNode[]; edges: CircuitEdge[] } {
  const sup = supply ?? { ref: 'VDD', value: '1.8' }
  const order = chainOrder(parts)

  // 1) 行分け: すべての信号ピンにラベルが付く最悪の幅で見積もる
  const rows: LayoutPart[][] = [[]]
  let rowWidth = 0
  for (const part of order) {
    const worst = [
      ...globalAttachments(part, sup),
      ...signalPins(part).map((p) => makeAttachment(part, p.handle, p.net, 'label', sup)),
    ]
    const e = extents(part, worst)
    const w = e.x1 - e.x0 + PART_GAP
    if (rows[rows.length - 1].length > 0 && rowWidth + w > ROW_MAX_WIDTH) {
      rows.push([])
      rowWidth = 0
    }
    rows[rows.length - 1].push(part)
    rowWidth += w
  }

  // 2) 同じ行で隣接する部品が共有するネットはクラスタとして直接配線する
  type PinRef = { part: LayoutPart; handle: string; role: PinRole }
  const clusters: { net: string; pins: PinRef[] }[] = []
  for (const row of rows) {
    let open = new Map<string, { net: string; pins: PinRef[] }>()
    for (const part of row) {
      const nextOpen = new Map<string, { net: string; pins: PinRef[] }>()
      for (const p of signalPins(part)) {
        const cluster = open.get(p.net) ?? nextOpen.get(p.net) ?? { net: p.net, pins: [] }
        if (cluster.pins.length === 0) clusters.push(cluster)
        cluster.pins.push({ part, handle: p.handle, role: p.role })
        nextOpen.set(p.net, cluster)
      }
      open = nextOpen
    }
  }

  const edges: CircuitEdge[] = []
  const addEdge = (source: string, sourceHandle: string, target: string, targetHandle: string) => {
    edges.push({ id: `w${edges.length + 1}`, source, sourceHandle, target, targetHandle })
  }

  const attachByPart = new Map<LayoutPart, Attachment[]>()
  const attach = (a: Attachment) => attachByPart.set(a.part, [...(attachByPart.get(a.part) ?? []), a])
  for (const part of order) globalAttachments(part, sup).forEach(attach)

  for (const c of clusters) {
    for (let i = 0; i + 1 < c.pins.length; i++) {
      const a = c.pins[i]
      const b = c.pins[i + 1]
      addEdge(a.part.node.id, a.handle, b.part.node.id, b.handle)
    }
    // ネット名を残すため各クラスタに 1 つラベルを付ける（駆動ピン優先）。
    // 右向きピンは隣への直結ワイヤが真横に伸びるので、ラベルは一段上にずらす
    const host = c.pins.find((p) => p.role === 'out') ?? c.pins[0]
    const hostDir = symbolGeom(host.part.node.data).pins[host.handle].dir
    const kind = c.pins.length > 1 && hostDir === Position.Right ? 'label_offset' : 'label'
    attach(makeAttachment(host.part, host.handle, c.net, kind, sup, attachByPart.get(host.part)))
  }

  // 3) 座標を確定（行内は付属記号どうしが重ならない間隔で詰める）
  let prevBottom: number | null = null
  for (const row of rows) {
    const ext = row.map((part) => ({ part, e: extents(part, attachByPart.get(part) ?? []), ay: anchorY(part) }))
    const top = Math.min(...ext.map(({ e, ay }) => e.y0 - ay))
    const bottom = Math.max(...ext.map(({ e, ay }) => e.y1 - ay))
    const baseline: number = prevBottom === null ? MARGIN - top : prevBottom + ROW_GAP - top
    let x = MARGIN
    for (const { part, e, ay } of ext) {
      part.node.position = { x: x - e.x0, y: baseline - ay }
      x += Math.ceil((e.x1 - e.x0 + PART_GAP) / GRID) * GRID
    }
    prevBottom = baseline + bottom
  }

  const nodes: CircuitNode[] = parts.map((p) => p.node)
  let seq = 0
  for (const part of order) {
    for (const a of attachByPart.get(part) ?? []) {
      seq++
      const id = `${a.data.kind}_${seq}`
      nodes.push({
        id,
        type: a.data.kind,
        position: { x: part.node.position.x + a.dx, y: part.node.position.y + a.dy },
        data: a.data,
      })
      addEdge(part.node.id, a.handle, id, 'pin')
    }
  }

  // 電源ピンが無くても電源記号（= 電源の定義）は残す
  if (supply && !nodes.some((n) => n.data.kind === 'vdd')) {
    nodes.push({
      id: 'vdd_supply',
      type: 'vdd',
      position: { x: MARGIN, y: MARGIN },
      data: { kind: 'vdd', ref: supply.ref, value: supply.value },
    })
  }

  return { nodes, edges }
}
