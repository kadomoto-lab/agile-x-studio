import type {
  AnalysisType,
  CircuitNode,
  SchematicDocument,
} from './types'
import { getLibraryItem } from './library'
import {
  layoutSchematic,
  pinRole,
  type LayoutPart,
  type SupplyInfo,
} from './autoLayout'
import { nextManualNetName } from './netNames'

/** トップレベル行から回路タイトルを抽出（.SUBCKT 内の X_BC 等を除外）。 */
function extractNetlistTitle(rawLines: string[]): string {
  // SPICE では 1 行目がタイトル。回路図からの出力も "* タイトル" で始まる
  const first = rawLines.find((l) => l)
  if (first?.startsWith('*') && !/^\*\s*GA_IO\b/i.test(first)) {
    const t = first.replace(/^\*+\s*/, '').trim()
    if (t) return t
  }
  let subcktDepth = 0
  for (const line of rawLines) {
    if (!line) continue
    const lower = line.toLowerCase()
    if (lower.startsWith('.subckt')) {
      subcktDepth += 1
      continue
    }
    if (lower.startsWith('.ends')) {
      subcktDepth = Math.max(0, subcktDepth - 1)
      continue
    }
    if (subcktDepth > 0) continue
    if (line.startsWith('*') || line.startsWith('.')) continue
    if (/^X[A-Za-z0-9_]*\s/i.test(line)) continue
    return line
  }
  return 'Imported Circuit'
}

/** 簡易ネットリスト → ブロック図（サンプル読込用）。配置は autoLayout.ts。 */
export function netlistToSchematic(netlist: string): SchematicDocument | null {
  const rawLines = netlist.split('\n').map((l) => l.trim())
  const lines = rawLines.filter(
    (l) =>
      l &&
      (!l.startsWith('*') || /^\*\s*GA_IO\b/i.test(l)),
  )

  if (lines.length === 0) return null

  const title = extractNetlistTitle(rawLines)
  let analysis: SchematicDocument['analysis'] = {
    type: 'tran',
    params: '10u 5m',
  }

  const parts: LayoutPart[] = []
  let supply: SupplyInfo | null = null
  // X 付き部品は ref から X を外すので、XC1 と C1 などが同じ ID にならないようにする
  const usedIds = new Set<string>()
  const uniqueId = (base: string) => {
    let id = base
    for (let i = 2; usedIds.has(id); i++) id = `${base}_${i}`
    usedIds.add(id)
    return id
  }
  let subcktDepth = 0

  for (const line of lines) {
    const lower = line.toLowerCase()
    if (lower === '.end') break
    if (lower.startsWith('.subckt')) {
      subcktDepth += 1
      continue
    }
    if (lower.startsWith('.ends')) {
      subcktDepth = Math.max(0, subcktDepth - 1)
      continue
    }
    if (line.startsWith('.tran')) {
      analysis = { type: 'tran' satisfies AnalysisType, params: line.slice(5).trim() }
      continue
    }
    if (line.startsWith('.ac')) {
      analysis = { type: 'ac' satisfies AnalysisType, params: line.slice(3).trim() }
      continue
    }
    if (line.startsWith('.op')) {
      analysis = { type: 'op' satisfies AnalysisType, params: '' }
      continue
    }
    if (line.startsWith('.') || subcktDepth > 0) continue

    const gaIo = parseGaIoLine(line)
    if (gaIo) {
      parts.push({
        node: {
          id: uniqueId(`n_${gaIo.ref}`),
          type: gaIo.kind,
          position: { x: 0, y: 0 },
          data: {
            kind: gaIo.kind,
            ref: gaIo.ref,
            value: '0',
            padIndex: gaIo.padIndex,
          },
        },
        pins: [{ handle: 'pin', net: gaIo.net, role: pinRole(gaIo.kind, 'pin') }],
      })
      continue
    }

    const parsed = parseComponentLine(line)
    if (!parsed) continue

    // VDD 電源は部品として置かず、各ピンのローカル電源記号が定義を持つ
    if (parsed.kind === 'vdd') {
      supply = { ref: parsed.ref, value: parsed.value }
      continue
    }

    const handles =
      parsed.pinHandles.length > 0
        ? parsed.pinHandles
        : ['a', 'b'].slice(0, parsed.nets.length)
    parts.push({
      node: {
        id: uniqueId(`n_${parsed.ref}`),
        type: parsed.kind,
        position: { x: 0, y: 0 },
        data: {
          kind: parsed.kind,
          ref: parsed.ref,
          value: parsed.value,
          netName: parsed.netName,
        },
      },
      pins: parsed.nets.map((net, i) => {
        const handle = handles[i] ?? 'a'
        return { handle, net, role: pinRole(parsed.kind, handle) }
      }),
    })
  }

  if (parts.length === 0 && !supply) return null

  const { nodes, edges } = layoutSchematic(parts, supply)
  return { title, nodes, edges, analysis }
}

function parseGaIoLine(line: string): {
  kind: 'ga_io_in' | 'ga_io_out'
  ref: string
  padIndex: number
  net: string
} | null {
  let s = line.trim()
  if (s.startsWith('*')) s = s.slice(1).trim()
  const parts = s.split(/\s+/)
  if (parts.length < 4 || parts[0].toUpperCase() !== 'GA_IO') return null
  const dir = parts[1].toUpperCase()
  if (dir !== 'IN' && dir !== 'OUT') return null
  const padIndex = parseInt(parts[2], 10)
  if (Number.isNaN(padIndex) || padIndex < 0 || padIndex > 12) return null
  const net = parts[3]
  const kind = dir === 'IN' ? 'ga_io_in' : 'ga_io_out'
  const prefix = dir === 'IN' ? 'IOI' : 'IOO'
  return {
    kind,
    ref: `${prefix}${padIndex}`,
    padIndex,
    net,
  }
}

function parseComponentLine(line: string): {
  kind: CircuitNode['data']['kind']
  ref: string
  value: string
  nets: string[]
  pinHandles: string[]
  netName?: string
  position?: { x: number; y: number }
} | null {
  const parts = line.split(/\s+/)
  if (parts.length < 4) return null

  const ref = parts[0]
  const prefix = ref[0].toUpperCase()
  const elementRef = prefix === 'X' ? ref.slice(1) : ref

  if (prefix === 'X') {
    const subckt = parts[parts.length - 1]
    const nets = parts.slice(1, -1)
    const kind = subcktToKind(subckt)
    if (!kind) return null
    const lib = getLibraryItem(kind)
    return {
      kind,
      ref: elementRef,
      value: lib.defaultValue,
      nets,
      pinHandles: lib.pins.map((p) => p.id),
    }
  }

  if (prefix === 'R') {
    return {
      kind: 'resistor',
      ref,
      value: parts[3],
      nets: [parts[1], parts[2]],
      pinHandles: ['a', 'b'],
    }
  }
  if (prefix === 'C') {
    return {
      kind: 'capacitor',
      ref,
      value: parts[3],
      nets: [parts[1], parts[2]],
      pinHandles: ['a', 'b'],
    }
  }
  if (prefix === 'L') {
    return {
      kind: 'inductor',
      ref,
      value: parts[3],
      nets: [parts[1], parts[2]],
      pinHandles: ['a', 'b'],
    }
  }
  if (prefix === 'V') {
    const na = parts[1]
    const nb = parts[2]
    const rest = parts.slice(3).join(' ')
    const lower = rest.toLowerCase()
    if (nb === '0' && na === 'VDD' && lower.startsWith('dc')) {
      const volts = parts[3] === 'dc' ? parts[4] ?? '1.8' : parts[3]
      return {
        kind: 'vdd',
        ref: ref.length > 1 ? ref.slice(1) : 'VDD',
        value: volts,
        nets: [na],
        pinHandles: ['pin'],
      }
    }
    if (lower.startsWith('pulse')) {
      return { kind: 'voltage_pulse', ref, value: rest, nets: [na, nb], pinHandles: ['a', 'b'] }
    }
    if (lower.startsWith('sin')) {
      return { kind: 'voltage_sin', ref, value: rest, nets: [na, nb], pinHandles: ['a', 'b'] }
    }
    if (lower.startsWith('ac')) {
      return { kind: 'voltage_ac', ref, value: rest, nets: [na, nb], pinHandles: ['a', 'b'] }
    }
    if (lower.startsWith('dc')) {
      return {
        kind: 'voltage_dc',
        ref,
        value: parts[3] === 'dc' ? parts[4] ?? '1' : parts[3],
        nets: [na, nb],
        pinHandles: ['a', 'b'],
      }
    }
    return { kind: 'voltage_sin', ref, value: rest, nets: [na, nb], pinHandles: ['a', 'b'] }
  }
  if (prefix === 'I') {
    return {
      kind: 'current_dc',
      ref,
      value: parts.slice(3).join(' '),
      nets: [parts[1], parts[2]],
      pinHandles: ['a', 'b'],
    }
  }
  return null
}

function subcktToKind(subckt: string): CircuitNode['data']['kind'] | null {
  const map: Record<string, CircuitNode['data']['kind']> = {
    INV: 'inv',
    NAND2: 'nand2',
    NOR2: 'nor2',
    NMOS: 'nmos',
    PMOS: 'pmos',
    MOSCAP: 'moscap',
    Z__GABASECELL: 'gabasecell',
  }
  return map[subckt] ?? null
}

export function createNodeFromLibrary(
  kind: CircuitNode['data']['kind'],
  position: { x: number; y: number },
  existingNodes: CircuitNode[],
): CircuitNode {
  const lib = getLibraryItem(kind)
  const id = `n_${crypto.randomUUID().slice(0, 8)}`
  const ref =
    kind === 'ground'
      ? 'GND'
      : kind === 'vdd'
        ? 'VDD'
        : kind === 'net_label'
          ? 'NET'
          : nextRefFromNodes(kind, existingNodes)

  return {
    id,
    type: kind,
    position,
    data: {
      kind,
      ref,
      value: lib.defaultValue,
      netName:
        kind === 'net_label'
          ? nextManualNetName(
              existingNodes.map((n) => n.data.netName ?? n.data.value),
            )
          : undefined,
      padIndex:
        kind === 'ga_io_in' || kind === 'ga_io_out' ? 0 : undefined,
    },
  }
}

function nextRefFromNodes(
  kind: CircuitNode['data']['kind'],
  nodes: CircuitNode[],
): string {
  const prefix = getLibraryItem(kind).spicePrefix
  const nums = nodes
    .filter((n) => n.data.ref.startsWith(prefix))
    .map((n) => parseInt(n.data.ref.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n))
  return `${prefix}${nums.length > 0 ? Math.max(...nums) + 1 : 1}`
}
