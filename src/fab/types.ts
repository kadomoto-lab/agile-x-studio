export type FabPoint = {
  x: number
  y: number
}

export type FabLayerRef = {
  layer: number
  datatype: number
  name?: string
}

export type FabPin = {
  name: string
  position: FabPoint
  layer: FabLayerRef
}

export type FabGateArrayCell = {
  id: string
  row: number
  col: number
  index: number
  origin: FabPoint
  size: { width: number; height: number }
  pins: FabPin[]
}

export type GateArrayCatalog = {
  version: number
  description: string
  units: 'um'
  baseGds: {
    path: string
    fileName: string
    topCell: string
    bbox: [number, number, number, number]
  }
  gateArray: {
    cellName: string
    totalCount: number
    rows: number
    columnsPerRow: number
    indexOrigin: 'bottom-left'
    indexOrder: 'row-major'
  }
  grid: {
    origin: FabPoint
    pitch: FabPoint
    siteSize: { width: number; height: number }
  }
  baseCell: {
    name: string
    bbox: [number, number, number, number]
    size: { width: number; height: number }
    pinTemplate: FabPin[]
    metal5AccessPoints: FabPoint[]
  }
  cells: FabGateArrayCell[]
}
