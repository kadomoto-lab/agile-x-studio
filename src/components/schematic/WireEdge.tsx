import { useContext } from 'react'
import { BaseEdge, type EdgeProps } from '@xyflow/react'
import { WireRoutesContext } from './wireContext'

const JUNCTION_R = 3.5

/** 直交配線のワイヤ。経路と接続点は WireRoutesContext から受け取る。 */
export function WireEdge({ id, sourceX, sourceY, targetX, targetY, interactionWidth }: EdgeProps) {
  const route = useContext(WireRoutesContext).get(id)
  const points = route?.points ?? [
    [sourceX, sourceY],
    [targetX, targetY],
  ]
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')

  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={interactionWidth ?? 12} />
      {route?.junctions.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r={JUNCTION_R} className="schematic-junction" />
      ))}
    </>
  )
}
