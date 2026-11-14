import type { ResultType } from './simulation'
import { messages } from '../i18n'

export type WaveformTrace = {
  name: string
  color: string
  values: number[]
}

export type WaveformData = {
  xLabel: string
  yLabel: string
  /** 横軸の単位（時間なら s、周波数なら Hz） */
  xUnit: string
  x: number[]
  traces: WaveformTrace[]
}

/**
 * 波形の色。Agile-X のブランド色を基にし、白地で線が見えるよう明るすぎる色（ゴールドなど）は
 * 暗めに寄せ、隣り合う色の色相を離している。
 */
const TRACE_COLORS = [
  '#187fc4',
  '#037b4e',
  '#c0392b',
  '#a87700',
  '#0d3b5c',
  '#c8620a',
  '#6b4fa0',
  '#4c8a2e',
]

const SI_PREFIXES: [number, string][] = [
  [-15, 'f'],
  [-12, 'p'],
  [-9, 'n'],
  [-6, 'µ'],
  [-3, 'm'],
  [0, ''],
  [3, 'k'],
  [6, 'M'],
  [9, 'G'],
]

/** 信号名から単位を推定する（v(...) は V、i(...) は A） */
export function traceUnit(name: string): string {
  if (/^v\(/i.test(name)) return 'V'
  if (/^i\(/i.test(name)) return 'A'
  return ''
}

function siPrefix(maxAbs: number): [number, string] {
  const exp = Math.min(9, Math.max(-15, Math.floor(Math.log10(maxAbs) / 3) * 3))
  return [exp, SI_PREFIXES.find(([e]) => e === exp)?.[1] ?? '']
}

/** 1 つの値を有効数字 3 桁で SI 接頭辞つきにする（例: 4.7e-6 → "4.7 µF"） */
function formatSiValue(v: number, unit: string): string {
  if (v === 0) return unit ? `0 ${unit}` : '0'
  const [exp, prefix] = siPrefix(Math.abs(v))
  return `${Number((v / 10 ** exp).toPrecision(3))} ${prefix}${unit}`
}

/**
 * 目盛りの値を SI 接頭辞つきで表す（例: 5e-9 → "5 ns"）。
 * 1 本の軸の目盛りは同じ接頭辞にそろえ、刻み幅に合わせて小数の桁数を決める。
 * 単位のない値には接頭辞をつけず、桁が大きく違う目盛り（対数軸など）は 1 つずつ表す。
 */
export function formatSiTicks(ticks: number[], unit: string): string[] {
  const finite = ticks.filter((t) => Number.isFinite(t))
  const maxAbs = finite.reduce((m, t) => Math.max(m, Math.abs(t)), 0)
  if (maxAbs === 0) return ticks.map(() => (unit ? `0 ${unit}` : '0'))
  const minAbs = finite.reduce((m, t) => (t !== 0 ? Math.min(m, Math.abs(t)) : m), Infinity)

  if (!unit) {
    if (maxAbs >= 1e5 || maxAbs < 1e-3) return ticks.map((t) => (t === 0 ? '0' : t.toExponential(1)))
    return ticks.map((t) => String(Number(t.toPrecision(4))))
  }
  if (maxAbs / minAbs >= 1000) return ticks.map((t) => formatSiValue(t, unit))

  const [exp, prefix] = siPrefix(maxAbs)
  const scale = 10 ** exp
  const step = finite.length > 1 ? Math.abs(finite[1] - finite[0]) / scale : maxAbs / scale
  const decimals = Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)))
  return ticks.map((t) => {
    const text = (t / scale).toFixed(decimals)
    return `${Number(text) === 0 ? '0' : text} ${prefix}${unit}`
  })
}

const POWER_RAIL_RE = /^v\(vdd\)$/i
const GROUND_RAIL_RE = /^v\(0\)$/i

function isFlatTrace(values: number[]): boolean {
  if (values.length === 0) return true
  let min = values[0]
  let max = values[0]
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min < 1e-9
}

function shouldIncludeTrace(name: string, values: number[]): boolean {
  if (POWER_RAIL_RE.test(name) || GROUND_RAIL_RE.test(name)) return false
  if (/^i\(v(vdd)?\)$/i.test(name)) return false
  if (isFlatTrace(values)) return false
  return true
}

function magnitude(real: number, img: number): number {
  return Math.sqrt(real * real + img * img)
}

function findAxisIndex(result: ResultType): number {
  const names = result.variableNames.map((n) => n.toLowerCase())
  const timeIdx = names.indexOf('time')
  if (timeIdx >= 0) return timeIdx
  const freqIdx = names.indexOf('frequency')
  if (freqIdx >= 0) return freqIdx
  return 0
}

function axisUnit(axisName: string): string {
  const lower = axisName.toLowerCase()
  if (lower === 'time') return 's'
  if (lower === 'frequency') return 'Hz'
  return ''
}

function axisLabel(axisName: string): string {
  const lower = axisName.toLowerCase()
  if (lower === 'time') return messages.waveform.axisTime
  if (lower === 'frequency') return messages.waveform.axisFrequency
  return axisName
}

/** 現在のロケールでの軸ラベル（ロケール切替時に再計算する）。 */
export function waveformLabels(
  result: ResultType,
): Pick<WaveformData, 'xLabel' | 'yLabel'> {
  const axisName = result.variableNames[findAxisIndex(result)] ?? 'x'
  return {
    xLabel: axisLabel(axisName),
    yLabel:
      result.dataType === 'complex'
        ? messages.waveform.yAmplitude
        : messages.waveform.yValue,
  }
}

export function resultToWaveform(result: ResultType): WaveformData {
  const axisIdx = findAxisIndex(result)

  if (result.dataType === 'complex') {
    const axis = result.data[axisIdx]
    const x =
      axis?.values.map((v) => magnitude(v.real, v.img)) ??
      result.data[0]?.values.map((_, i) => i) ??
      []

    const traces: WaveformTrace[] = []
    let colorIdx = 0

    for (let i = 0; i < result.data.length; i++) {
      if (i === axisIdx) continue
      const series = result.data[i]
      const values = series.values.map((v) => magnitude(v.real, v.img))
      if (!shouldIncludeTrace(series.name, values)) continue
      traces.push({
        name: `${series.name} |V|`,
        color: TRACE_COLORS[colorIdx % TRACE_COLORS.length],
        values,
      })
      colorIdx++
    }

    return { ...waveformLabels(result), xUnit: axisUnit(result.variableNames[axisIdx] ?? ''), x, traces }
  }

  const x = result.data[axisIdx]?.values ?? []
  const traces: WaveformTrace[] = []
  let colorIdx = 0

  for (let i = 0; i < result.data.length; i++) {
    if (i === axisIdx) continue
    const series = result.data[i]
    if (!shouldIncludeTrace(series.name, series.values)) continue
    traces.push({
      name: series.name,
      color: TRACE_COLORS[colorIdx % TRACE_COLORS.length],
      values: series.values,
    })
    colorIdx++
  }

  return { ...waveformLabels(result), xUnit: axisUnit(result.variableNames[axisIdx] ?? ''), x, traces }
}
