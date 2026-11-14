import type { ComponentKind } from '../schematic/types'
import type { FabPrimitive, PrimitiveCatalog } from './primitiveTypes'

const CATALOG_URL = `${import.meta.env.BASE_URL}fab/primitives.json`

let cached: PrimitiveCatalog | null = null

export async function loadPrimitiveCatalog(): Promise<PrimitiveCatalog> {
  if (cached) return cached
  const res = await fetch(CATALOG_URL)
  if (!res.ok) {
    throw new Error(`Failed to load primitive catalog: ${res.status}`)
  }
  cached = (await res.json()) as PrimitiveCatalog
  return cached
}

export function getPrimitiveBySubckt(
  catalog: PrimitiveCatalog,
  spiceSubckt: string,
): FabPrimitive | undefined {
  return catalog.primitives.find((p) => p.spiceSubckt === spiceSubckt)
}

export function getPrimitiveByKind(
  catalog: PrimitiveCatalog,
  kind: ComponentKind,
): FabPrimitive | undefined {
  return catalog.primitives.find((p) => p.schematicKind === kind)
}
