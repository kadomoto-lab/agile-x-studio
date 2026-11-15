import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

// テスト実行用の依存パッケージを追加せず、アプリと同じTypeScriptモジュールを読み込む。
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})
let file, library, samples, converter, netlist, saveFile
try {
  file = await server.ssrLoadModule('/src/schematic/file.ts')
  library = await server.ssrLoadModule('/src/schematic/library.ts')
  samples = await server.ssrLoadModule('/src/samples/circuits.ts')
  converter = await server.ssrLoadModule('/src/schematic/netlistToSchematic.ts')
  netlist = await server.ssrLoadModule('/src/schematic/netlist.ts')
  saveFile = await server.ssrLoadModule('/src/schematic/saveFile.ts')
} finally {
  await server.close()
}
const { serializeSchematic, parseSchematicFile, schematicFilename, SchematicFileError } = file

function document() {
  return {
    title: '保存テスト',
    analysis: { type: 'tran', params: '1n 10u' },
    nodes: library.COMPONENT_LIBRARY.map((item, index) => ({
      id: `node-${index}`,
      type: item.kind,
      position: { x: index * 10 - 20, y: 30.5 },
      data: {
        kind: item.kind, ref: `U${index}`, value: item.defaultValue,
        ...(item.kind === 'net_label' ? { netName: '信号', flip: true } : {}),
        ...(item.kind.startsWith('ga_io_') ? { padIndex: 12 } : {}),
      },
    })),
    edges: [{ id: 'wire-1', type: 'wire', source: 'node-0', sourceHandle: 'a', target: 'node-1', targetHandle: 'b' }],
  }
}

test('round-trip preserves every component kind, positions, connections and settings', () => {
  const doc = document()
  assert.deepEqual(parseSchematicFile(serializeSchematic(doc)), doc)
})

test('all samples preserve their generated netlists after saving and restoring', () => {
  for (const id of samples.SAMPLE_IDS) {
    const doc = converter.netlistToSchematic(samples.buildSampleNetlist(id))
    assert.ok(doc, id)
    const restored = parseSchematicFile(serializeSchematic(doc))
    assert.equal(netlist.schematicToNetlist(restored), netlist.schematicToNetlist(doc), id)
    assert.deepEqual(restored.nodes.map((n) => n.position), doc.nodes.map((n) => n.position))
  }
})

test('empty and unfinished schematics can be saved without generating a netlist', () => {
  for (const type of ['tran', 'ac', 'op']) {
    const doc = { title: '', analysis: { type, params: '' }, nodes: [], edges: [] }
    assert.deepEqual(parseSchematicFile(serializeSchematic(doc)), doc)
  }
})

test('temporary editor state and arbitrary React Flow options are not restored', () => {
  const doc = document()
  Object.assign(doc.nodes[0], { selected: true, dragging: true, measured: { width: 10 }, hidden: true })
  Object.assign(doc.edges[0], { selected: true, hidden: true, style: { display: 'none' } })
  const restored = parseSchematicFile(serializeSchematic(doc))
  assert.deepEqual(restored, document())
})

test('rejects broken, unrelated and unsupported files', () => {
  for (const text of ['{', 'null', '[]', '{}', JSON.stringify(document())]) {
    assert.throws(() => parseSchematicFile(text), SchematicFileError)
  }
  const saved = JSON.parse(serializeSchematic(document()))
  saved.version = 2
  assert.throws(() => parseSchematicFile(JSON.stringify(saved)), SchematicFileError)
})

test('rejects invalid nodes, analysis, references and pin handles without mutating input', () => {
  const mutations = [
    (d) => { d.analysis.type = 'invalid' },
    (d) => { d.analysis.params = null },
    (d) => { d.nodes[0].data.kind = 'unknown' },
    (d) => { d.nodes[0].type = 'inv' },
    (d) => { d.nodes[0].position.x = null },
    (d) => { d.nodes[0].data.value = {} },
    (d) => { d.nodes[0].data.flip = 'true' },
    (d) => { d.nodes[0].data.netName = [] },
    (d) => { d.nodes[0].data.padIndex = 13 },
    (d) => { d.nodes[0].data.padIndex = 1.5 },
    (d) => { d.nodes[1].id = d.nodes[0].id },
    (d) => { d.edges[0].source = 'missing' },
    (d) => { d.edges[0].targetHandle = 'missing' },
    (d) => { delete d.edges[0].sourceHandle },
    (d) => { d.edges.push({ ...d.edges[0] }) },
  ]
  for (const mutate of mutations) {
    const saved = JSON.parse(serializeSchematic(document()))
    mutate(saved.schematic)
    const before = structuredClone(saved)
    assert.throws(() => parseSchematicFile(JSON.stringify(saved)), SchematicFileError)
    assert.deepEqual(saved, before)
  }
})

test('filenames preserve Japanese titles and replace characters unsuitable for local files', () => {
  assert.equal(schematicFilename('回路図'), '回路図.json')
  assert.equal(schematicFilename('回路図.json'), '回路図.json')
  assert.equal(schematicFilename('回路図 (2).json'), '回路図 (2).json')
  assert.equal(schematicFilename('a/b:c\\d?'), 'a_b_c_d_.json')
  assert.equal(schematicFilename(' .. '), 'schematic.json')
})

test('downloads the complete schematic using the filename as its title without file-system access', async (t) => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let blob, clicked = false, removed = false, release
  const link = {
    href: '', download: '',
    click: () => { clicked = true },
    remove: () => { removed = true },
  }
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:schematic' })
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {})
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => link,
    body: { appendChild: () => {} },
  } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: (callback) => { release = callback },
  } })
  try {
    const doc = document()
    const before = structuredClone(doc)
    saveFile.downloadSchematic(doc, '自分の回路.json')
    assert.equal(link.download, '自分の回路.json')
    assert.equal(clicked, true)
    assert.equal(removed, true)
    assert.equal(blob.type, 'application/json')
    assert.deepEqual(parseSchematicFile(await blob.text()), { ...before, title: '自分の回路' })
    assert.deepEqual(doc, before)
    assert.equal(revoke.mock.callCount(), 0)
    release()
    assert.equal(revoke.mock.calls[0].arguments[0], 'blob:schematic')
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  }
})
