import { SPICE_PREAMBLE } from '../schematic/spice/gabasecell'

export type SampleId = 'ring31' | 'inv2Pulse' | 'adder4'

const RING_STAGES = 31

function buildRingOscillatorBody(stages: number): string {
  const lines = [
    `* ${stages}-stage ring oscillator`,
    '',
    'V62 n62 0 dc 1.8',
    'XU1 n1 n2 VDD 0 INV',
    'XU2 n2 n3 VDD 0 INV',
    'XU3 n62 n4 n1 VDD 0 NAND2',
    'XU4 n3 n5 VDD 0 INV',
  ]
  for (let i = 5; i < stages; i++) {
    lines.push(`XU${i} n${i} n${i + 1} VDD 0 INV`)
  }
  lines.push(`XU${stages} n${stages} n4 VDD 0 INV`)
  lines.push(`XU${stages + 1} n4 n33 VDD 0 INV`)
  lines.push(`XU${stages + 2} n33 n34 VDD 0 INV`)
  lines.push(
    '',
    '* --- chip I/O pads ---',
    '* GA_IO OUT 0 n34',
    '* GA_IO IN 0 n62',
    '',
    '* power supplies',
    'VVDD VDD 0 dc 1.8',
    '',
    '.tran 10p 50n uic',
    '.end',
    '',
  )
  return lines.join('\n')
}

function buildInv2PulseBody(): string {
  return [
    '* 2-stage inverter (pulse input)',
    '',
    'V1 n1 0 PULSE(0 1.8 0 1n 1n 50n 100n)',
    'XU1 n1 n2 VDD 0 INV',
    'XU2 n2 n3 VDD 0 INV',
    '',
    '* power supplies',
    'VVDD VDD 0 dc 1.8',
    '',
    '.tran 10p 500n',
    '.end',
    '',
  ].join('\n')
}

/** 入力ベクタ 1 ステップの長さ [ns]（4 ビット分のキャリー伝搬より十分長く取る） */
const ADDER_STEP_NS = 20
const ADDER_BITS = 4

const EDGE_NS = 0.5

/** ビット i が 2^i ステップごとに反転する方形波（A を 0,1,2,... とカウントアップ）。 */
function countBitPulse(i: number, stepNs: number): string {
  const half = stepNs * 2 ** i
  return `PULSE(0 1.8 ${half}n ${EDGE_NS}n ${EDGE_NS}n ${half - EDGE_NS}n ${2 * half}n)`
}

/** t = atNs で from → to へ 1 回だけ切り替わる入力（スキーマ取込のため PULSE で表す）。 */
function stepPulse(from: number, to: number, atNs: number): string {
  if (from === to) return `dc ${from ? 1.8 : 0}`
  const v0 = from ? 1.8 : 0
  const v1 = to ? 1.8 : 0
  return `PULSE(${v0} ${v1} ${atNs}n ${EDGE_NS}n ${EDGE_NS}n 1u 2u)`
}

/**
 * 4 ビット リップルキャリー加算器（NAND2 のみ、全加算器 9 ゲート × 4 = 36 ゲート）。
 * 1 行 35 サイトに収まらないため 2 行にまたがって配置・配線される。
 * 入力 A/B/Cin と出力 S/Cout はすべてチップ I/O パッドへ出す。
 */
function buildAdder4Body(): string {
  const bits = ADDER_BITS
  // 入力ベクタ: A は 0→15 をカウントアップ（2 周）、B は前半 5・後半 10、Cin は後半のみ 1
  const steps = 32
  const switchNs = (steps / 2) * ADDER_STEP_NS
  const bFirst = 5
  const bSecond = 10

  const lines = [
    `* ${bits}-bit ripple-carry adder (NAND2 only, ${bits * 9} gates -> 2 GA rows)`,
    '* full adder: x = a ^ b, s = x ^ cin, cout = ~(~(a&b) & ~(x&cin))',
    '',
  ]
  let u = 1
  for (let i = 0; i < bits; i++) {
    const a = `a${i}`
    const b = `b${i}`
    const ci = i === 0 ? 'cin' : `c${i}`
    const co = i === bits - 1 ? 'cout' : `c${i + 1}`
    const p = `fa${i}_`
    lines.push(
      `* bit ${i}`,
      `XU${u++} ${a} ${b} ${p}n1 VDD 0 NAND2`,
      `XU${u++} ${a} ${p}n1 ${p}n2 VDD 0 NAND2`,
      `XU${u++} ${b} ${p}n1 ${p}n3 VDD 0 NAND2`,
      `XU${u++} ${p}n2 ${p}n3 ${p}x VDD 0 NAND2`,
      `XU${u++} ${p}x ${ci} ${p}n4 VDD 0 NAND2`,
      `XU${u++} ${p}x ${p}n4 ${p}n5 VDD 0 NAND2`,
      `XU${u++} ${ci} ${p}n4 ${p}n6 VDD 0 NAND2`,
      `XU${u++} ${p}n5 ${p}n6 s${i} VDD 0 NAND2`,
      `XU${u++} ${p}n4 ${p}n1 ${co} VDD 0 NAND2`,
    )
  }

  lines.push(
    '',
    `* input vectors: A = 0..15 (x2), B = ${bFirst} then ${bSecond}, Cin = 0 then 1`,
  )
  for (let i = 0; i < bits; i++) {
    lines.push(`VA${i} a${i} 0 ${countBitPulse(i, ADDER_STEP_NS)}`)
  }
  for (let i = 0; i < bits; i++) {
    const from = (bFirst >> i) & 1
    const to = (bSecond >> i) & 1
    lines.push(`VB${i} b${i} 0 ${stepPulse(from, to, switchNs)}`)
  }
  lines.push(`VCIN cin 0 ${stepPulse(0, 1, switchNs)}`)

  lines.push('', '* --- chip I/O pads ---')
  const inputs = [
    ...Array.from({ length: bits }, (_, i) => `a${i}`),
    ...Array.from({ length: bits }, (_, i) => `b${i}`),
    'cin',
  ]
  inputs.forEach((net, pad) => lines.push(`* GA_IO IN ${pad} ${net}`))
  for (let i = 0; i < bits; i++) lines.push(`* GA_IO OUT ${i} s${i}`)
  lines.push(`* GA_IO OUT ${bits} cout`)

  lines.push(
    '',
    '* power supplies',
    'VVDD VDD 0 dc 1.8',
    '',
    `.tran 20p ${steps * ADDER_STEP_NS}n`,
    '.end',
    '',
  )
  return lines.join('\n')
}

const SAMPLE_BODIES: Record<SampleId, () => string> = {
  ring31: () => buildRingOscillatorBody(RING_STAGES),
  inv2Pulse: buildInv2PulseBody,
  adder4: buildAdder4Body,
}

export const SAMPLE_IDS: SampleId[] = ['ring31', 'inv2Pulse', 'adder4']

export const DEFAULT_SAMPLE_ID: SampleId = 'ring31'

export function buildSampleNetlist(id: SampleId): string {
  // SPICE の慣習どおり 1 行目を回路タイトルにする（本体先頭のコメント行）
  const [title, ...rest] = SAMPLE_BODIES[id]().split('\n')
  const body = rest.join('\n').replace(/^\n+/, '')
  return `${title}\n\n${SPICE_PREAMBLE.trim()}\n\n* --- schematic instances ---\n\n${body}`
}

export const DEFAULT_NETLIST = buildSampleNetlist(DEFAULT_SAMPLE_ID)
