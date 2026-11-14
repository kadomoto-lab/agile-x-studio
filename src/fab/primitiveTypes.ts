import type { FabLayerRef } from './types'

export type FabPinDirection = 'input' | 'output' | 'inout' | 'power'

export type FabExternalPin = {
  name: string
  direction: FabPinDirection
}

export type FabGatePinMap = {
  gatePin: string
  net: string
  /** Primitive external pin; null for internal nets (e.g. NA, NB) */
  primitivePin: string | null
}

export type FabMetal5Tie = {
  net: string
  gatePins: string[]
  externalPin: string | null
}

export type FabGateInstance = {
  instance: string
  baseCell: string
  gateIndex: number
  spiceLine: string
  pinMap: FabGatePinMap[]
  metal5Ties: FabMetal5Tie[]
}

export type FabInterGateMetal5 = {
  net: string
  from: { gateInstance: string; net?: string; gatePin?: string }
  to: { gateInstance: string; net?: string; gatePin?: string }
}

export type FabPrimitive = {
  id: string
  label: string
  schematicKind: string
  spiceSubckt: string
  gateCount: number
  fabricationNote?: string
  externalPins: FabExternalPin[]
  gates: FabGateInstance[]
  interGateMetal5?: FabInterGateMetal5[]
}

export type PrimitiveCatalog = {
  version: number
  description: string
  units: 'um'
  layer: FabLayerRef
  baseCell: {
    name: string
    pinOrder: string[]
    terminalY?: number[]
    routingTracks?: number[]
    vddBusY?: number
    vssBusY?: number
  }
  primitives: FabPrimitive[]
}
