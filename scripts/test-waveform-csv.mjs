import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
})
let resultToCsv
try {
  ;({ resultToCsv } = await server.ssrLoadModule('/src/lib/waveformCsv.ts'))
} finally {
  await server.close()
}

function result(dataType, data) {
  return { header: '', numVariables: data.length, numPoints: data[0]?.values.length ?? 0,
    variableNames: data.map((s) => s.name), dataType, data }
}

test('transient CSV includes the time axis, units, constant rails and all unrounded data points', () => {
  const data = result('real', [
    { name: 'time', type: 'time', values: [0, 1e-12, 2e-12] },
    { name: 'v(out)', type: 'voltage', values: [0, 1.2345678901234567, -1] },
    { name: 'i(v1)', type: 'current', values: [0, -0.00001, 0.00001] },
    { name: 'v(vdd)', type: 'voltage', values: [1.8, 1.8, 1.8] },
  ])
  assert.equal(resultToCsv(data),
    'time (s),v(out) (V),i(v1) (A),v(vdd) (V)\r\n' +
    '0,0,0,1.8\r\n1e-12,1.2345678901234567,-0.00001,1.8\r\n2e-12,-1,0.00001,1.8\r\n')
})

test('AC CSV preserves real and imaginary components instead of reducing them to magnitude', () => {
  const data = result('complex', [
    { name: 'frequency', type: 'frequency', values: [{ real: 100, img: 0 }, { real: 1000, img: 0 }] },
    { name: 'v(out)', type: 'voltage', values: [{ real: 3, img: -4 }, { real: 0, img: 2 }] },
  ])
  assert.equal(resultToCsv(data),
    'frequency.real (Hz),frequency.imag (Hz),v(out).real (V),v(out).imag (V)\r\n' +
    '100,0,3,-4\r\n1000,0,0,2\r\n')
})

test('signal names with commas, quotes, newlines and Japanese text are preserved and escaped', () => {
  const data = result('real', [
    { name: 'v(入力,出力)', type: 'voltage', values: [1] },
    { name: 'a"b\nc', type: 'unknown', values: [2] },
  ])
  assert.equal(resultToCsv(data), '"v(入力,出力) (V)","a""b\nc"\r\n1,2\r\n')
})

test('missing or non-finite values stay empty without shifting columns or losing later points', () => {
  const data = result('real', [
    { name: 'time', type: 'time', values: [0, 1] },
    { name: 'signal', type: 'unknown', values: [NaN, Infinity, 4] },
  ])
  assert.equal(resultToCsv(data), 'time (s),signal\r\n0,\r\n1,\r\n,4\r\n')
  assert.equal(resultToCsv(result('real', [])), '')
})
