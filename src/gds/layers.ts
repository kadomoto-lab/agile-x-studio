export type GdsLayerSpec = {
  name: string
  layer: number
  datatype: number
  color: string
}

/** 表示対象レイヤ（PDK: METAL4 / VIA45 / METAL5） */
export const GDS_DISPLAY_LAYERS: GdsLayerSpec[] = [
  { name: 'METAL4', layer: 31, datatype: 0, color: '#e8a838' },
  { name: 'VIA45', layer: 32, datatype: 0, color: '#6b8cff' },
  { name: 'METAL5', layer: 33, datatype: 0, color: '#38d4a8' },
]

/** Vite が .gz を自動展開するため、非圧縮 JSON を既定にする */
export const DEFAULT_GDS_URL = `${import.meta.env.BASE_URL}gds/base.json`
