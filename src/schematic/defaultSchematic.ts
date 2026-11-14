import type { SchematicDocument } from './types'
import { netlistToSchematic } from './netlistToSchematic'
import { buildSampleNetlist, DEFAULT_SAMPLE_ID } from '../samples/circuits'

/** デフォルト netlist からブロック図を生成（31 ゲート リングオシレータ）。 */
export const DEFAULT_SCHEMATIC: SchematicDocument =
  netlistToSchematic(buildSampleNetlist(DEFAULT_SAMPLE_ID)) ?? {
    title: '31-stage ring oscillator',
    analysis: { type: 'tran', params: '10p 50n' },
    nodes: [],
    edges: [],
  }
