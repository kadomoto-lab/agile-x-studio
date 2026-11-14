import type { FabGateArrayCell, GateArrayCatalog } from './types'

const CATALOG_URL = `${import.meta.env.BASE_URL}fab/gate-array.json`

let cached: GateArrayCatalog | null = null

export async function loadGateArrayCatalog(): Promise<GateArrayCatalog> {
  if (cached) return cached
  const res = await fetch(CATALOG_URL)
  if (!res.ok) {
    throw new Error(`Failed to load gate array catalog: ${res.status}`)
  }
  cached = (await res.json()) as GateArrayCatalog
  return cached
}

export function getGateArrayCell(
  catalog: GateArrayCatalog,
  row: number,
  col: number,
): FabGateArrayCell | undefined {
  return catalog.cells.find((c) => c.row === row && c.col === col)
}
