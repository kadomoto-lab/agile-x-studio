import { useCallback, useRef, useState } from 'react'
import type { SchematicDocument } from '../schematic/types'
import { DEFAULT_SCHEMATIC } from '../schematic/defaultSchematic'
import {
  buildSampleNetlist,
  DEFAULT_NETLIST,
  DEFAULT_SAMPLE_ID,
  type SampleId,
} from '../samples/circuits'
import { netlistToSchematic } from '../schematic/netlistToSchematic'
import { schematicToNetlist } from '../schematic/netlist'
import type { DesignTab } from '../components/DesignPane'

/** 回路図の編集を取り消し履歴に積むときの情報 */
export type SchematicUndoPoint = {
  /** この編集の直前の回路図（取り消すとここへ戻る） */
  before: SchematicDocument
  /** 同じキーの編集が続けて来たら 1 手にまとめる（プロパティ入力の 1 文字ごと等） */
  mergeKey?: string
}

const UNDO_LIMIT = 100
const MERGE_MS = 1000

/** 回路図から生成されるネットリスト（生成できない回路図は null） */
function netlistOf(doc: SchematicDocument): string | null {
  try {
    return schematicToNetlist(doc)
  } catch {
    return null
  }
}

export function useCircuitProject() {
  const [sampleId, setSampleId] = useState<SampleId | null>(DEFAULT_SAMPLE_ID)
  const [schematicFileName, setSchematicFileName] = useState<string | null>(null)
  const [schematic, setSchematicState] = useState<SchematicDocument>(DEFAULT_SCHEMATIC)
  const [netlist, setNetlist] = useState(DEFAULT_NETLIST)
  const [designTab, setDesignTab] = useState<DesignTab>('schematic')
  const [schematicDirty, setSchematicDirty] = useState(false)
  const [netlistSource, setNetlistSource] = useState<'schematic' | 'manual'>(
    'schematic',
  )
  // ネットリストから回路図を作り直した回数（ブロック図の表示範囲を合わせ直す合図）
  const [importRevision, setImportRevision] = useState(0)

  // 取り消し／やり直しは最新の回路図・ネットリストに対して行うので ref でも持つ
  const schematicRef = useRef(schematic)
  const netlistRef = useRef(netlist)
  // 最後にネットリストと揃えた時点の回路図が生成するネットリスト。
  // 未同期かどうかはネットリスト本文（サンプルはコメント付きの手書き書式）ではなく
  // これと比べる。React Flow が表示時に寸法を通知しても未同期にならない
  const syncedSchematicNetlist = useRef<string | null>(netlistOf(schematic))
  const isDirty = useCallback(
    (doc: SchematicDocument) => netlistOf(doc) !== syncedSchematicNetlist.current,
    [],
  )
  const markSynced = useCallback((doc: SchematicDocument) => {
    syncedSchematicNetlist.current = netlistOf(doc)
    setSchematicDirty(false)
  }, [])
  const history = useRef({
    past: [] as SchematicDocument[],
    future: [] as SchematicDocument[],
    lastKey: undefined as string | undefined,
    lastAt: 0,
  })

  const setSchematic = useCallback((doc: SchematicDocument) => {
    schematicRef.current = doc
    setSchematicState(doc)
  }, [])

  /** ネットリストから作り直した回路図には、それ以前の編集を戻せない */
  const resetHistory = useCallback(() => {
    history.current = { past: [], future: [], lastKey: undefined, lastAt: 0 }
  }, [])

  const onSchematicChange = useCallback(
    (doc: SchematicDocument, undo?: SchematicUndoPoint) => {
      if (undo) {
        const h = history.current
        const now = Date.now()
        const merge =
          undo.mergeKey !== undefined &&
          undo.mergeKey === h.lastKey &&
          now - h.lastAt < MERGE_MS
        if (!merge) {
          h.past.push(undo.before)
          if (h.past.length > UNDO_LIMIT) h.past.shift()
        }
        h.future = []
        h.lastKey = undo.mergeKey
        h.lastAt = now
      }
      setSchematic(doc)
      setSchematicDirty(isDirty(doc))
    },
    [setSchematic, isDirty],
  )

  const stepHistory = useCallback(
    (from: 'past' | 'future') => {
      const h = history.current
      const doc = h[from].pop()
      if (!doc) return
      h[from === 'past' ? 'future' : 'past'].push(schematicRef.current)
      h.lastKey = undefined
      setSchematic(doc)
      setSchematicDirty(isDirty(doc))
    },
    [setSchematic, isDirty],
  )
  const undoSchematic = useCallback(() => stepHistory('past'), [stepHistory])
  const redoSchematic = useCallback(() => stepHistory('future'), [stepHistory])

  const onNetlistChange = useCallback(
    (value: string) => {
      netlistRef.current = value
      setNetlist(value)
      setNetlistSource('manual')
      const imported = netlistToSchematic(value)
      if (imported) {
        setSchematic(imported)
        resetHistory()
        setImportRevision((r) => r + 1)
        // 取り込んだ回路図はこのネットリストと揃っている
        markSynced(imported)
      } else {
        setSchematicDirty(true)
      }
    },
    [setSchematic, resetHistory, markSynced],
  )

  const saveFromSchematic = useCallback((generated: string) => {
    netlistRef.current = generated
    setNetlist(generated)
    syncedSchematicNetlist.current = generated
    setSchematicDirty(false)
    setNetlistSource('schematic')
  }, [])

  const importSchematic = useCallback((doc: SchematicDocument, fileName: string) => {
    onSchematicChange(doc, { before: schematicRef.current })
    setSampleId(null)
    setSchematicFileName(fileName)
    setImportRevision((r) => r + 1)
  }, [onSchematicChange])

  const loadSample = useCallback(
    (id: SampleId) => {
      const generated = buildSampleNetlist(id)
      const imported = netlistToSchematic(generated)
      setSampleId(id)
      setSchematicFileName(null)
      netlistRef.current = generated
      setNetlist(generated)
      setNetlistSource('schematic')
      if (imported) {
        setSchematic(imported)
        resetHistory()
        setImportRevision((r) => r + 1)
        markSynced(imported)
      } else {
        setSchematicDirty(true)
      }
    },
    [setSchematic, resetHistory, markSynced],
  )

  return {
    sampleId,
    schematicFileName,
    setSchematicFileName,
    schematic,
    netlist,
    designTab,
    schematicDirty,
    netlistSource,
    importRevision,
    setDesignTab,
    onSchematicChange,
    undoSchematic,
    redoSchematic,
    onNetlistChange,
    saveFromSchematic,
    importSchematic,
    loadSample,
  }
}
