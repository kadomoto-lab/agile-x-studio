import { downloadBlob } from './download'
import type { ResultType, VariableType } from './simulation'

function unit(type: VariableType): string {
  switch (type) {
    case 'time': return 's'
    case 'frequency': return 'Hz'
    case 'voltage': return 'V'
    case 'current': return 'A'
    default: return ''
  }
}

function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function heading(name: string, type: VariableType): string {
  const suffix = unit(type)
  return csvCell(suffix ? `${name} (${suffix})` : name)
}

/** 表示・非表示や拡大範囲によらず、返された全信号・全データ点を出力する。 */
export function resultToCsv(result: ResultType): string {
  if (result.data.length === 0) return ''
  const columns = result.dataType === 'complex'
    ? result.data.flatMap((series) => [
      { header: heading(`${series.name}.real`, series.type), values: series.values.map((v) => v.real) },
      { header: heading(`${series.name}.imag`, series.type), values: series.values.map((v) => v.img) },
    ])
    : result.data.map((series) => ({ header: heading(series.name, series.type), values: series.values }))
  const rows = [columns.map((column) => column.header).join(',')]
  const count = columns.reduce((max, column) => Math.max(max, column.values.length), 0)
  for (let i = 0; i < count; i++) {
    rows.push(columns.map((column) => {
      const value = column.values[i]
      return Number.isFinite(value) ? String(value) : ''
    }).join(','))
  }
  return `${rows.join('\r\n')}\r\n`
}

export function downloadWaveformCsv(result: ResultType): void {
  // 表計算ソフトで日本語などの信号名を正しく読み込めるよう、UTF-8 BOMを付ける。
  const blob = new Blob(['\ufeff', resultToCsv(result)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, 'waveform.csv')
}
