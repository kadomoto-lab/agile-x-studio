import { useEffect, useMemo, useState } from 'react'
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import type { CircuitEdge, CircuitNode } from '../../schematic/types'
import { snapToGrid } from '../../schematic/symbols'
import {
  previewWire,
  wireTargetAt,
  type PinRef,
  type Pt,
  type WireRoute,
} from '../../schematic/wireRouting'
import { WIRE_HIT_PX } from './wireContext'

const ACCENT = '#187fc4'

/**
 * クリック配線中のゴースト（Undine 風）: 始点からカーソルまでの直交経路を破線で示し、
 * 接続できるピン・ワイヤの上では吸着点を丸で示す。ReactFlow の子として置く。
 */
export function WirePreview({
  from,
  start,
  nodes,
  edges,
  routes,
}: {
  from: PinRef
  start: Pt
  nodes: CircuitNode[]
  edges: CircuitEdge[]
  routes: Map<string, WireRoute>
}) {
  const { screenToFlowPosition } = useReactFlow()
  const domNode = useStore((s) => s.domNode)
  const zoom = useStore((s) => s.transform[2])
  const [cursor, setCursor] = useState<Pt>(start)

  useEffect(() => {
    if (!domNode) return
    const onMove = (e: PointerEvent) => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setCursor([p.x, p.y])
    }
    domNode.addEventListener('pointermove', onMove)
    return () => domNode.removeEventListener('pointermove', onMove)
  }, [domNode, screenToFlowPosition])

  const target = useMemo(() => {
    const t = wireTargetAt(nodes, edges, routes, cursor[0], cursor[1], WIRE_HIT_PX / zoom)
    return t && !(t.pin.nodeId === from.nodeId && t.pin.handle === from.handle) ? t : null
  }, [nodes, edges, routes, cursor, zoom, from])

  const path = useMemo(() => {
    const to: PinRef | Pt = target ? target.pin : [snapToGrid(cursor[0]), snapToGrid(cursor[1])]
    return previewWire(nodes, edges, routes, from, to)
  }, [nodes, edges, routes, from, target, cursor])

  const d = path?.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')
  const px = 1 / zoom

  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
        {d && (
          <path
            d={d}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.75 * px}
            strokeDasharray={`${5 * px} ${4 * px}`}
          />
        )}
        <rect
          x={start[0] - 3 * px}
          y={start[1] - 3 * px}
          width={6 * px}
          height={6 * px}
          fill={ACCENT}
        />
        {target && (
          <circle
            cx={target.point[0]}
            cy={target.point[1]}
            r={6 * px}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.75 * px}
          />
        )}
      </svg>
    </ViewportPortal>
  )
}
