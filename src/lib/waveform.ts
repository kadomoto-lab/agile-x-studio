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
  x: number[]
  traces: WaveformTrace[]
}

const TRACE_COLORS = [
  '#187fc4',
  '#037b4e',
  '#f8bb00',
  '#388fca',
  '#004fa0',
  '#f1942e',
  '#002137',
  '#c0392b',
]

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

    return { ...waveformLabels(result), x, traces }
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

  return { ...waveformLabels(result), x, traces }
}
