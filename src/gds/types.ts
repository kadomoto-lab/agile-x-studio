export type GdsLayoutLayer = {
  name: string
  layer: number
  datatype: number
  color: string
  /** 平坦化座標 [x0,y0,x1,y1,...] の配列 */
  polygons: number[][]
}

export type GdsLayout = {
  title: string
  source: string
  bbox: [number, number, number, number]
  layers: GdsLayoutLayer[]
}

export type GdsPolygonItem = {
  layerIndex: number
  polyIndex: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}
