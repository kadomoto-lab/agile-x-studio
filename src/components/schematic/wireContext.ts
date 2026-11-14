import { createContext } from 'react'
import type { WireRoute } from '../../schematic/wireRouting'

/** 辺 ID → 直交配線の経路と接続点（SchematicEditor が全体で計算する） */
export const WireRoutesContext = createContext<Map<string, WireRoute>>(new Map())

/** 未接続ピン `nodeId:handle` の集合 */
export const DanglingPinsContext = createContext<ReadonlySet<string>>(new Set())

/** 配線ツールで、カーソルからこの距離（画面 px）以内のピン・ワイヤに吸着する */
export const WIRE_HIT_PX = 8
