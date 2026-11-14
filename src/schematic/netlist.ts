import type {
  CircuitEdge,
  CircuitNode,
  ComponentKind,
  SchematicDocument,
} from './types'
import { getLibraryItem, getPinIds } from './library'
import { SPICE_PREAMBLE, spiceInstance } from './spice/gabasecell'
import {
  AUTO_NET_START,
  maxNumericNetIndex,
  nextAutoNetName,
} from './netNames'

type PinRef = string

class UnionFind {
  private parent = new Map<PinRef, PinRef>()

  find(x: PinRef): PinRef {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let root = x
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!
    }
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: PinRef, b: PinRef): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

function pinKey(nodeId: string, handleId: string): PinRef {
  return `${nodeId}:${handleId}`
}

/** ネット名を与えるノード（ネットラベル / GND / VDD）なら、その名前 */
function namedNet(node: CircuitNode): string | null {
  if (node.data.kind === 'net_label') return node.data.netName?.trim() || null
  if (node.data.kind === 'ground') return '0'
  if (node.data.kind === 'vdd') return 'VDD'
  return null
}

function resolveNetNames(
  nodes: CircuitNode[],
  edges: CircuitEdge[],
): Map<PinRef, string> {
  const uf = new UnionFind()

  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue
    uf.union(
      pinKey(edge.source, edge.sourceHandle),
      pinKey(edge.target, edge.targetHandle),
    )
  }

  // 同名のネットラベル・GND・VDD 記号は配線が無くても同じネット（xschem と同じ規則）
  const pinByName = new Map<string, PinRef>()
  for (const node of nodes) {
    const name = namedNet(node)
    if (!name) continue
    const key = pinKey(node.id, 'pin')
    const first = pinByName.get(name)
    if (first) uf.union(first, key)
    else pinByName.set(name, key)
  }

  const labelByRoot = new Map<PinRef, string>()
  for (const [name, key] of pinByName) {
    labelByRoot.set(uf.find(key), name)
  }

  const roots = new Set<PinRef>()
  for (const node of nodes) {
    for (const handle of getPinIds(node.data.kind)) {
      roots.add(uf.find(pinKey(node.id, handle)))
    }
  }

  const rootToNet = new Map<PinRef, string>()
  const usedNames = new Set<string>()

  // 接続グループごとにラベル名を確定（別名ラベルが同じグループにある場合は 1 つだけ採用）
  for (const root of roots) {
    if (!labelByRoot.has(root)) continue
    const label = labelByRoot.get(root)!
    if (usedNames.has(label)) continue
    usedNames.add(label)
    rootToNet.set(root, label)
  }

  const autoCursor = {
    value: Math.max(
      AUTO_NET_START,
      maxNumericNetIndex(usedNames) + 1,
    ),
  }

  for (const root of roots) {
    if (rootToNet.has(root)) continue
    rootToNet.set(root, nextAutoNetName(usedNames, autoCursor))
  }

  const pinToNet = new Map<PinRef, string>()
  for (const node of nodes) {
    for (const handle of getPinIds(node.data.kind)) {
      const key = pinKey(node.id, handle)
      const root = uf.find(key)
      pinToNet.set(key, rootToNet.get(root) ?? '0')
    }
  }

  return pinToNet
}

function netOf(
  pinToNet: Map<PinRef, string>,
  nodeId: string,
  handle: string,
): string {
  return pinToNet.get(pinKey(nodeId, handle)) ?? '0'
}

function powerSupplyLines(
  nodes: CircuitNode[],
  pinToNet: Map<PinRef, string>,
): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const node of nodes) {
    if (node.data.kind !== 'vdd') continue
    const net = netOf(pinToNet, node.id, 'pin')
    if (seen.has(net)) continue
    seen.add(net)
    lines.push(`V${node.data.ref} ${net} 0 dc ${node.data.value}`)
  }
  return lines
}

function spiceLineForNode(
  node: CircuitNode,
  pinToNet: Map<PinRef, string>,
): string | null {
  const { kind, ref, value } = node.data
  if (kind === 'ground' || kind === 'vdd' || kind === 'net_label') return null
  if (kind === 'ga_io_in' || kind === 'ga_io_out') return null

  const lib = getLibraryItem(kind)

  if (lib.spiceSubckt) {
    const nets = lib.pins.map((pin) => netOf(pinToNet, node.id, pin.id))
    return spiceInstance(ref, lib.spiceSubckt, nets)
  }

  const na = netOf(pinToNet, node.id, 'a')
  const nb = netOf(pinToNet, node.id, 'b')

  switch (kind) {
    case 'resistor':
    case 'capacitor':
    case 'inductor':
      return `${ref} ${na} ${nb} ${value}`
    case 'voltage_dc':
      return `${ref} ${na} ${nb} dc ${value}`
    case 'voltage_sin':
    case 'voltage_pulse':
      return `${ref} ${na} ${nb} ${value}`
    case 'voltage_ac':
      return `${ref} ${na} ${nb} ${value}`
    case 'current_dc':
      return `${ref} ${na} ${nb} ${value}`
    default:
      return null
  }
}

function usesGabasecellLibrary(nodes: CircuitNode[]): boolean {
  return nodes.some((n) => getLibraryItem(n.data.kind).spiceSubckt != null)
}

function analysisLine(doc: SchematicDocument): string {
  const { type, params } = doc.analysis
  switch (type) {
    case 'tran':
      return `.tran ${params}`
    case 'ac':
      return `.ac ${params}`
    case 'op':
      return '.op'
  }
}

function gaIoPadLines(
  nodes: CircuitNode[],
  pinToNet: Map<PinRef, string>,
): string[] {
  const lines: string[] = []
  for (const node of nodes) {
    if (node.data.kind !== 'ga_io_in' && node.data.kind !== 'ga_io_out') continue
    const net = netOf(pinToNet, node.id, 'pin')
    const idx = node.data.padIndex ?? 0
    const dir = node.data.kind === 'ga_io_in' ? 'IN' : 'OUT'
    lines.push(`* GA_IO ${dir} ${idx} ${net}`)
  }
  return lines
}

function sanitizeSchematicTitle(title: string): string {
  const t = title.trim().replace(/^\*+\s*/, '')
  if (!t || /^X[A-Za-z0-9_]*\s/i.test(t) || t.startsWith('.')) {
    return '* Schematic Circuit'
  }
  return `* ${t}`
}

export function schematicToNetlist(doc: SchematicDocument): string {
  const components = doc.nodes.filter(
    (n) =>
      n.data.kind !== 'ground' &&
      n.data.kind !== 'vdd' &&
      n.data.kind !== 'net_label' &&
      n.data.kind !== 'ga_io_in' &&
      n.data.kind !== 'ga_io_out',
  )

  if (components.length === 0) {
    throw new Error('No components in schematic')
  }

  const pinToNet = resolveNetNames(doc.nodes, doc.edges)
  const lines: string[] = [sanitizeSchematicTitle(doc.title), '']

  if (usesGabasecellLibrary(doc.nodes)) {
    lines.push(SPICE_PREAMBLE.trim(), '', '* --- schematic instances ---', '')
  }

  for (const node of doc.nodes) {
    const line = spiceLineForNode(node, pinToNet)
    if (line) lines.push(line)
  }

  const ioPads = gaIoPadLines(doc.nodes, pinToNet)
  if (ioPads.length > 0) {
    lines.push('', '* --- chip I/O pads ---', ...ioPads)
  }

  const supplies = powerSupplyLines(doc.nodes, pinToNet)
  if (supplies.length > 0) {
    lines.push('', '* power supplies', ...supplies)
  }

  lines.push('', analysisLine(doc), '.end', '')
  return lines.join('\n')
}

/** True when schematic connectivity/values match the given netlist text. */
export function schematicMatchesNetlist(
  doc: SchematicDocument,
  netlist: string,
): boolean {
  try {
    return schematicToNetlist(doc) === netlist
  } catch {
    return false
  }
}

/** Expand spiceTemplate with ref and resolved nets (for property panel preview). */
export function formatSpiceTemplate(
  kind: ComponentKind,
  ref: string,
  pinToNet: Map<PinRef, string>,
  nodeId: string,
): string | null {
  const lib = getLibraryItem(kind)
  if (!lib.spiceTemplate) return null
  let tpl = lib.spiceTemplate.replace('{ref}', ref)
  for (const pin of lib.pins) {
    tpl = tpl.replace(`{${pin.id}}`, netOf(pinToNet, nodeId, pin.id))
  }
  return tpl
}

export { resolveNetNames, netOf, pinKey }
