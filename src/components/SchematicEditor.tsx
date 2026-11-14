import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionLineType,
  ConnectionMode,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CircuitNode, ComponentKind, SchematicDocument } from '../schematic/types'
import { CircuitNodeView } from './schematic/CircuitNode'
import { ComponentLibrary, DRAG_KIND } from './schematic/ComponentLibrary'
import { PropertyPanel } from './schematic/PropertyPanel'
import { WireEdge } from './schematic/WireEdge'
import { WirePreview } from './schematic/WirePreview'
import { DanglingPinsContext, WIRE_HIT_PX, WireRoutesContext } from './schematic/wireContext'
import { createNodeFromLibrary } from '../schematic/netlistToSchematic'
import { GRID, snapToGrid, symbolGeom } from '../schematic/symbols'
import {
  danglingPins,
  routeWires,
  wireTargetAt,
  type PinRef,
  type Pt,
} from '../schematic/wireRouting'
import { messages } from '../i18n'
import type { SchematicUndoPoint } from '../hooks/useCircuitProject'

const nodeTypes: NodeTypes = {
  resistor: CircuitNodeView,
  capacitor: CircuitNodeView,
  inductor: CircuitNodeView,
  voltage_dc: CircuitNodeView,
  voltage_sin: CircuitNodeView,
  voltage_pulse: CircuitNodeView,
  voltage_ac: CircuitNodeView,
  current_dc: CircuitNodeView,
  inv: CircuitNodeView,
  nand2: CircuitNodeView,
  nor2: CircuitNodeView,
  nmos: CircuitNodeView,
  pmos: CircuitNodeView,
  moscap: CircuitNodeView,
  gabasecell: CircuitNodeView,
  ground: CircuitNodeView,
  vdd: CircuitNodeView,
  net_label: CircuitNodeView,
  ga_io_in: CircuitNodeView,
  ga_io_out: CircuitNodeView,
}

const edgeTypes: EdgeTypes = {
  wire: WireEdge,
}

type SchematicEditorProps = {
  document: SchematicDocument
  /** undo を渡した変更だけが取り消し履歴に積まれる（選択やドラッグ途中は積まない） */
  onDocumentChange: (doc: SchematicDocument, undo?: SchematicUndoPoint) => void
  onUndo: () => void
  onRedo: () => void
}

/** 履歴に積む編集の指定。before 省略時は編集直前の回路図 */
type UndoSpec = { before?: SchematicDocument; mergeKey?: string }

export function SchematicEditor(props: SchematicEditorProps) {
  // 画面座標 → 回路図座標の変換（配線ツール・ドロップ）に useReactFlow を使う
  return (
    <ReactFlowProvider>
      <SchematicCanvas {...props} />
    </ReactFlowProvider>
  )
}

function SchematicCanvas({
  document,
  onDocumentChange,
  onUndo,
  onRedo,
}: SchematicEditorProps) {
  const { nodes, edges } = document
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { screenToFlowPosition, getZoom } = useReactFlow()
  // クリック配線（Undine 風）: ピンをクリックで開始し、押し続けなくても引き回せる
  const [wiringFrom, setWiringFrom] = useState<PinRef | null>(null)

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'wire',
      selectable: true,
      focusable: true,
      interactionWidth: 24,
    }),
    [],
  )

  // React Flow は 1 回の操作でノードと辺の変更を続けて通知する（削除など）。
  // 2 つ目が古い document に重ねて 1 つ目を打ち消さないよう、最新版を ref で持つ
  const docRef = useRef(document)
  useLayoutEffect(() => {
    docRef.current = document
  }, [document])

  const patch = useCallback(
    (partial: Partial<SchematicDocument>, record?: UndoSpec) => {
      const before = docRef.current
      const next = { ...before, ...partial }
      docRef.current = next
      onDocumentChange(
        next,
        record && { before: record.before ?? before, mergeKey: record.mergeKey },
      )
    },
    [onDocumentChange],
  )

  // 同じイベント内の変更（ノード削除とそれに伴う辺の削除）を 1 手にまとめるキー
  const tickKey = useRef<string | null>(null)
  const sameTick = useCallback(() => {
    if (!tickKey.current) {
      tickKey.current = `tick:${performance.now()}`
      queueMicrotask(() => {
        tickKey.current = null
      })
    }
    return tickKey.current
  }, [])

  // ドラッグは開始時点の回路図を覚えておき、離したときに 1 手として積む
  const dragOrigin = useRef<SchematicDocument | null>(null)

  const onNodesChange: OnNodesChange<CircuitNode> = useCallback(
    (changes) => {
      const current = docRef.current
      const next = applyNodeChanges(changes, current.nodes)
      if (changes.some((c) => c.type === 'position')) {
        if (changes.some((c) => c.type === 'position' && c.dragging)) {
          dragOrigin.current ??= current
          patch({ nodes: next })
          return
        }
        const before = dragOrigin.current ?? current
        dragOrigin.current = null
        const was = new Map(before.nodes.map((n) => [n.id, n.position]))
        const moved = next.some((n) => {
          const p = was.get(n.id)
          return !p || p.x !== n.position.x || p.y !== n.position.y
        })
        patch({ nodes: next }, moved ? { before } : undefined)
        return
      }
      // 選択・寸法の変化は履歴に積まない
      const edit = changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace')
      patch({ nodes: next }, edit ? { mergeKey: sameTick() } : undefined)
    },
    [patch, sameTick],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const edit = changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace')
      patch(
        { edges: applyEdgeChanges(changes, docRef.current.edges) },
        edit ? { mergeKey: sameTick() } : undefined,
      )
    },
    [patch, sameTick],
  )

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      patch({ edges: addEdge(connection, docRef.current.edges) }, {})
    },
    [patch],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      // 入力欄では各欄の文字単位の取り消しを優先する
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      setWiringFrom(null)
      dragOrigin.current = null
      if (key === 'y' || e.shiftKey) onRedo()
      else onUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUndo, onRedo])

  const selectableEdges = useMemo(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      edges.map(({ style: _style, ...edge }) => ({
        ...edge,
        type: 'wire',
        selectable: true,
        focusable: true,
        interactionWidth: 12,
      })),
    [edges],
  )

  // 配線経路は全ワイヤをまとめて決める（他ネットとの重なり回避・接続点の判定）。
  // ドラッグ中はノード移動の描画を優先し、経路計算は後回しにする
  const routeNodes = useDeferredValue(nodes)
  const routeEdges = useDeferredValue(edges)
  const wireRoutes = useMemo(
    () => routeWires(routeNodes, routeEdges),
    [routeNodes, routeEdges],
  )

  // ノード移動のたびに全シンボルを再描画しないよう、内容が変わったときだけ差し替える
  const danglingKey = danglingPins(nodes, edges).join('|')
  const dangling = useMemo(() => new Set(danglingKey.split('|')), [danglingKey])

  const addComponent = useCallback(
    (kind: ComponentKind, position?: { x: number; y: number }) => {
      const raw = position ?? {
        x: 200 + Math.random() * 120,
        y: 100 + Math.random() * 200,
      }
      const pos = { x: snapToGrid(raw.x), y: snapToGrid(raw.y) }
      const current = docRef.current.nodes
      patch({ nodes: [...current, createNodeFromLibrary(kind, pos, current)] }, {})
    },
    [patch],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData(DRAG_KIND) as ComponentKind
      if (!kind) return
      // カーソル位置にシンボル中央が来るよう置く（ズーム・パンを考慮）
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const g = symbolGeom({ kind, ref: '', value: '' })
      addComponent(kind, { x: p.x - g.width / 2, y: p.y - g.height / 2 })
    },
    [addComponent, screenToFlowPosition],
  )

  const wiringStart = useMemo((): Pt | null => {
    const node = wiringFrom && nodes.find((n) => n.id === wiringFrom.nodeId)
    const pin = node && symbolGeom(node.data).pins[wiringFrom.handle]
    return node && pin ? [node.position.x + pin.x, node.position.y + pin.y] : null
  }, [nodes, wiringFrom])

  useEffect(() => {
    if (!wiringFrom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWiringFrom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wiringFrom])

  const onWireClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      if (!wiringFrom) {
        const handle = (e.target as Element).closest<HTMLElement>('.react-flow__handle')
        const nodeId = handle?.dataset.nodeid
        const pinId = handle?.dataset.handleid
        if (nodeId && pinId) setWiringFrom({ nodeId, handle: pinId })
        return
      }
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const target = wireTargetAt(nodes, edges, wireRoutes, p.x, p.y, WIRE_HIT_PX / getZoom())
      // 空白のクリックでは配線を続ける（経路は自動で決まるので曲がり角は置かない）
      if (!target) return
      e.stopPropagation()
      const { pin } = target
      if (pin.nodeId !== wiringFrom.nodeId || pin.handle !== wiringFrom.handle) {
        patch(
          {
            edges: addEdge(
              {
                source: wiringFrom.nodeId,
                sourceHandle: wiringFrom.handle,
                target: pin.nodeId,
                targetHandle: pin.handle,
              },
              docRef.current.edges,
            ),
          },
          {},
        )
      }
      setWiringFrom(null)
    },
    [wiringFrom, screenToFlowPosition, getZoom, nodes, edges, wireRoutes, patch],
  )

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const updateNode = useCallback(
    (nodeId: string, dataPatch: Partial<CircuitNode['data']>) => {
      patch(
        {
          nodes: docRef.current.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, ...dataPatch } } : n,
          ),
        },
        // 入力欄への連続入力は 1 手にまとめる
        { mergeKey: `node:${nodeId}:${Object.keys(dataPatch).sort().join(',')}` },
      )
    },
    [patch],
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      const { nodes: ns, edges: es } = docRef.current
      patch(
        {
          nodes: ns.filter((n) => n.id !== nodeId),
          edges: es.filter((e) => e.source !== nodeId && e.target !== nodeId),
        },
        {},
      )
      setSelectedId(null)
    },
    [patch],
  )

  return (
    <div className="flex h-full min-h-0">
      <ComponentLibrary onAdd={addComponent} />

      <div
        className={`relative min-w-0 flex-1 ${wiringFrom ? 'schematic-wiring' : ''}`}
        onClickCapture={onWireClick}
        onDoubleClick={() => setWiringFrom(null)}
        onContextMenu={(e) => {
          if (!wiringFrom) return
          e.preventDefault()
          setWiringFrom(null)
        }}
      >
        {wiringFrom && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-accent/40 bg-surface/95 px-2.5 py-1 text-[10px] text-accent shadow-sm">
            {messages.design.wiringHint}
          </div>
        )}
        <WireRoutesContext.Provider value={wireRoutes}>
        <DanglingPinsContext.Provider value={dangling}>
        <ReactFlow
          nodes={nodes}
          edges={selectableEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={() => setWiringFrom(null)}
          connectOnClick={false}
          defaultEdgeOptions={defaultEdgeOptions}
          onSelectionChange={({ nodes: sel }) => {
            setSelectedId(sel[0]?.id ?? null)
          }}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.Step}
          snapToGrid
          snapGrid={[GRID, GRID]}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.15}
          deleteKeyCode={['Backspace', 'Delete']}
          className="bg-surface-muted"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#d9d9d9" gap={GRID * 2} size={1} />
          <Controls
            className="!border-border !bg-surface !shadow-lg [&>button]:!border-border [&>button]:!bg-surface-muted [&>button]:!text-muted [&>button:hover]:!bg-surface-raised"
          />
          <MiniMap
            className="!border-border !bg-surface"
            nodeColor={(n) => {
              const kind = (n.data as CircuitNode['data']).kind
              if (kind === 'ground') return '#666666'
              if (kind === 'vdd') return '#c0392b'
              if (kind === 'net_label') return '#888888'
              return '#187fc4'
            }}
          />
          {wiringFrom && wiringStart && (
            <WirePreview
              from={wiringFrom}
              start={wiringStart}
              nodes={routeNodes}
              edges={routeEdges}
              routes={wireRoutes}
            />
          )}
        </ReactFlow>
        </DanglingPinsContext.Provider>
        </WireRoutesContext.Provider>
      </div>

      <PropertyPanel
        selectedNode={selectedNode}
        title={document.title}
        analysis={document.analysis}
        onTitleChange={(title) => patch({ title }, { mergeKey: 'title' })}
        onAnalysisChange={(analysis) => patch({ analysis }, { mergeKey: 'analysis' })}
        onNodeUpdate={updateNode}
        onDeleteNode={deleteNode}
      />
    </div>
  )
}
