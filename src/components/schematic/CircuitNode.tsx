import { memo, useContext } from 'react'
import { Handle, type NodeProps } from '@xyflow/react'
import type { CircuitNode } from '../../schematic/types'
import { getLibraryItem } from '../../schematic/library'
import { symbolGeom } from '../../schematic/symbols'
import { SchematicSymbol } from './SchematicSymbol'
import { DanglingPinsContext } from './wireContext'

function CircuitNodeComponent({ id, data, selected }: NodeProps<CircuitNode>) {
  const geom = symbolGeom(data)
  const dangling = useContext(DanglingPinsContext)
  const pinLabels = new Map(getLibraryItem(data.kind).pins.map((p) => [p.id, p.label]))

  return (
    <div className="relative" style={{ width: geom.width, height: geom.height }}>
      <SchematicSymbol data={data} />
      {selected && (
        <div className="pointer-events-none absolute -inset-1.5 rounded-sm border border-dashed border-highlight" />
      )}
      {Object.entries(geom.pins).map(([pinId, pin]) => (
        <Handle
          key={pinId}
          type="source"
          id={pinId}
          position={pin.dir}
          className={`schematic-pin${dangling.has(`${id}:${pinId}`) ? ' is-dangling' : ''}`}
          style={{ left: pin.x, top: pin.y, right: 'auto', bottom: 'auto' }}
          title={pinLabels.get(pinId)}
        />
      ))}
    </div>
  )
}

export const CircuitNodeView = memo(CircuitNodeComponent)
