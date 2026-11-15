import { COMPONENT_LIBRARY } from './library'
import type { CircuitNode, SchematicDocument } from './types'

const FORMAT = 'agile-x-studio-schematic'
const VERSION = 1

export class SchematicFileError extends Error {}

function invalid(): never {
  throw new SchematicFileError('Invalid schematic file')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid()
  return value
}

function id(value: unknown): string {
  const result = string(value)
  if (!result.trim()) invalid()
  return result
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid()
  return value
}

/** 保存対象の項目だけを検証・再構築し、ファイル内のReact Flow設定はそのまま取り込まない。 */
function readDocument(value: unknown): SchematicDocument {
  const doc = record(value)
  const analysis = record(doc.analysis)
  if (analysis.type !== 'tran' && analysis.type !== 'ac' && analysis.type !== 'op') invalid()
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) invalid()

  const byId = new Map<string, CircuitNode>()
  const nodes = doc.nodes.map((value): CircuitNode => {
    const node = record(value)
    const data = record(node.data)
    const position = record(node.position)
    const item = COMPONENT_LIBRARY.find((item) => item.kind === data.kind)
    if (!item || node.type !== item.kind) invalid()
    const nodeId = id(node.id)
    if (byId.has(nodeId)) invalid()
    if (data.netName !== undefined && typeof data.netName !== 'string') invalid()
    if (data.flip !== undefined && typeof data.flip !== 'boolean') invalid()
    if (data.padIndex !== undefined && (
      typeof data.padIndex !== 'number' || !Number.isInteger(data.padIndex) ||
      data.padIndex < 0 || data.padIndex > 12
    )) invalid()
    const result: CircuitNode = {
      id: nodeId,
      type: item.kind,
      position: { x: coordinate(position.x), y: coordinate(position.y) },
      data: {
        kind: item.kind,
        ref: string(data.ref),
        value: string(data.value),
        ...(data.netName !== undefined ? { netName: data.netName as string } : {}),
        ...(data.flip !== undefined ? { flip: data.flip as boolean } : {}),
        ...(data.padIndex !== undefined ? { padIndex: data.padIndex as number } : {}),
      },
    }
    byId.set(nodeId, result)
    return result
  })

  const edgeIds = new Set<string>()
  const edges = doc.edges.map((value) => {
    const edge = record(value)
    const edgeId = id(edge.id)
    if (edgeIds.has(edgeId)) invalid()
    edgeIds.add(edgeId)
    const source = id(edge.source)
    const target = id(edge.target)
    const sourceHandle = id(edge.sourceHandle)
    const targetHandle = id(edge.targetHandle)
    for (const [nodeId, handle] of [[source, sourceHandle], [target, targetHandle]]) {
      const node = byId.get(nodeId)
      const item = COMPONENT_LIBRARY.find((item) => item.kind === node?.data.kind)
      if (!item?.pins.some((pin) => pin.id === handle)) invalid()
    }
    return { id: edgeId, type: 'wire', source, target, sourceHandle, targetHandle }
  })

  return {
    title: string(doc.title),
    analysis: { type: analysis.type, params: string(analysis.params) },
    nodes,
    edges,
  }
}

export function serializeSchematic(doc: SchematicDocument): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, schematic: readDocument(doc) }, null, 2)
}

export function parseSchematicFile(text: string): SchematicDocument {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    invalid()
  }
  const file = record(value)
  if (file.format !== FORMAT || file.version !== VERSION) invalid()
  return readDocument(file.schematic)
}

export function schematicFilename(title: string): string {
  // eslint-disable-next-line no-control-regex -- ファイル名に使えない制御文字を置き換えるため。
  const name = title.trim().replace(/\.json$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '')
  return `${name.slice(0, 100) || 'schematic'}.json`
}
