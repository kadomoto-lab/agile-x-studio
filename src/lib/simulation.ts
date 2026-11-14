/**
 * SPICE シミュレーション（サーバ側 ngspice で実行）。
 *
 * 以前はブラウザ内 WASM（eecircuit-engine）で実行していたが、実行場所を
 * レイアウト API サーバ（/api/simulate）へ移した。返り値の形
 * （ResultType = eecircuit-engine 互換）は変えていないため、波形表示側は従来どおり。
 */
import { messages } from '../i18n'

export type VariableType = 'time' | 'frequency' | 'voltage' | 'current' | string

export type RealDataType = {
  name: string
  type: VariableType
  values: number[]
}

export type ComplexNumber = { real: number; img: number }

export type ComplexDataType = {
  name: string
  type: VariableType
  values: ComplexNumber[]
}

export type ResultType =
  | {
      header: string
      numVariables: number
      variableNames: string[]
      numPoints: number
      dataType: 'real'
      data: RealDataType[]
    }
  | {
      header: string
      numVariables: number
      variableNames: string[]
      numPoints: number
      dataType: 'complex'
      data: ComplexDataType[]
    }

export type RunResult = {
  data: ResultType
  info: string
  errors: string[]
}

type SimulateResponse = {
  data: ResultType | null
  info: string
  errors: string[]
  elapsed_s?: number
}

export type SimulatorStatus = {
  available: boolean
  simulator: string
  version?: string
  path?: string
  detail?: string
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
  } catch {
    // JSON でなければ本文をそのまま使う
  }
  return text || res.statusText
}

export async function runNetlist(netlist: string): Promise<RunResult> {
  let res: Response
  try {
    res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ netlist }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(messages.simulation.connectFailed(msg), { cause: err })
  }
  if (!res.ok) {
    throw new Error(
      messages.simulation.requestFailed(res.status, await errorDetail(res)),
    )
  }
  const body = (await res.json()) as SimulateResponse
  if (!body.data) {
    const reason = body.errors.length > 0 ? body.errors[0] : body.info
    throw new Error(messages.simulation.noResult(reason))
  }
  // errors はプロットが得られた場合も警告としてコンソールへ出す
  return { data: body.data, info: body.info, errors: body.errors }
}

/** サーバ側シミュレータの有無を確認する（起動時のエンジン準備に相当）。 */
export async function initEngine(): Promise<SimulatorStatus> {
  let res: Response
  try {
    res = await fetch('/api/simulate/status')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(messages.simulation.connectFailed(msg), { cause: err })
  }
  if (!res.ok) {
    throw new Error(
      messages.simulation.requestFailed(res.status, await errorDetail(res)),
    )
  }
  const status = (await res.json()) as SimulatorStatus
  if (!status.available) {
    throw new Error(status.detail ?? 'ngspice not available on the server')
  }
  return status
}
