import type { CircuitNodeData, ComponentKind } from '../../schematic/types'
import { isDigitalKind } from '../../schematic/library'
import {
  ioPadText,
  netLabelText,
  SOURCE_VALUE_CHARS,
  symbolGeom,
  type SymbolGeom,
} from '../../schematic/symbols'

/** シンボル線の色（ヘッダと同じネイビー）。配線（アクセント青）と区別する。 */
const INK = '#002137'
const MUTED = '#666666'

/** 種別ごとの差し色（従来ブロックの枠色）。本体の薄い塗りに使う。 */
const KIND_TINT: Record<ComponentKind, string> = {
  resistor: '#f8bb00',
  capacitor: '#187fc4',
  inductor: '#388fca',
  voltage_dc: '#037b4e',
  voltage_sin: '#037b4e',
  voltage_pulse: '#f8bb00',
  voltage_ac: '#388fca',
  current_dc: '#c0392b',
  inv: '#004fa0',
  nand2: '#002137',
  nor2: '#002137',
  nmos: '#187fc4',
  pmos: '#388fca',
  moscap: '#037b4e',
  gabasecell: '#666666',
  ground: '#666666',
  vdd: '#c0392b',
  net_label: '#888888',
  ga_io_in: '#e67e22',
  ga_io_out: '#2980b9',
}

const FONT = "'IBM Plex Mono', ui-monospace, monospace"

/** path / circle / rect 共通の線属性 */
type Paint = {
  fill: string
  fillOpacity?: number
  stroke: string
  strokeWidth: number
  strokeLinecap: 'round'
  strokeLinejoin: 'round'
}

const line: Paint = {
  fill: 'none',
  stroke: INK,
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function tinted(kind: ComponentKind): Paint {
  return { ...line, fill: KIND_TINT[kind], fillOpacity: 0.12 }
}

function Text({
  x,
  y,
  children,
  anchor = 'middle',
  size = 9,
  weight = 600,
  color = INK,
}: {
  x: number
  y: number
  children: string
  anchor?: 'start' | 'middle' | 'end'
  size?: number
  weight?: number
  color?: string
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={size}
      fontWeight={weight}
      fill={color}
      fontFamily={FONT}
    >
      {children}
    </text>
  )
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function displayRef(data: CircuitNodeData): string {
  return isDigitalKind(data.kind) ? `X${data.ref}` : data.ref
}

/** 本体・ピン引き出し線。showText=false でライブラリ用アイコンになる。 */
function SymbolBody({
  data,
  geom,
  showText,
}: {
  data: CircuitNodeData
  geom: SymbolGeom
  showText: boolean
}) {
  const { kind } = data
  const ref = displayRef(data)

  switch (kind) {
    case 'resistor':
      return (
        <>
          <path d="M0 20H14L16.7 14L22 26L27.3 14L32.7 26L38 14L43.3 26L46 20H60" {...line} />
          {showText && <Text x={30} y={8}>{ref}</Text>}
          {showText && <Text x={30} y={38} size={8.5} weight={400} color={MUTED}>{shorten(data.value, 12)}</Text>}
        </>
      )
    case 'capacitor':
      return (
        <>
          <path d="M0 20H27M33 20H60" {...line} />
          <path d="M27 10V30M33 10V30" {...line} strokeWidth={2.25} strokeLinecap="butt" />
          {showText && <Text x={30} y={7}>{ref}</Text>}
          {showText && <Text x={30} y={39} size={8.5} weight={400} color={MUTED}>{shorten(data.value, 12)}</Text>}
        </>
      )
    case 'inductor':
      return (
        <>
          <path d="M0 20H14a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0H60" {...line} />
          {showText && <Text x={30} y={8}>{ref}</Text>}
          {showText && <Text x={30} y={36} size={8.5} weight={400} color={MUTED}>{shorten(data.value, 12)}</Text>}
        </>
      )
    case 'voltage_dc':
    case 'voltage_sin':
    case 'voltage_pulse':
    case 'voltage_ac':
    case 'current_dc':
      return (
        <>
          <path d="M20 0V16M20 44V60" {...line} />
          <circle cx={20} cy={30} r={14} {...tinted(kind)} />
          <SourceGlyph kind={kind} />
          {showText && kind !== 'voltage_dc' && kind !== 'current_dc' && (
            <Text x={27} y={10} size={9} weight={700}>+</Text>
          )}
          {showText && <Text x={40} y={27} anchor="start">{ref}</Text>}
          {showText && (
            <Text x={40} y={38} anchor="start" size={8.5} weight={400} color={MUTED}>
              {shorten(data.value, SOURCE_VALUE_CHARS)}
            </Text>
          )}
        </>
      )
    case 'inv':
      return (
        <>
          <path d="M0 30H20M60 30H80M40 0V24.4M40 60V35.6" {...line} />
          <path d="M20 15V45L52 30Z" {...tinted(kind)} />
          <circle cx={56} cy={30} r={4} {...line} fill="#ffffff" />
          {showText && <Text x={46} y={10} anchor="start">{ref}</Text>}
        </>
      )
    case 'nand2':
      return (
        <>
          <path d="M0 20H18M0 40H18M60 30H80M40 0V14.5M40 60V45.5" {...line} />
          <path d="M18 14H36A16 16 0 0 1 36 46H18Z" {...tinted(kind)} />
          <circle cx={56} cy={30} r={4} {...line} fill="#ffffff" />
          {showText && <Text x={46} y={10} anchor="start">{ref}</Text>}
        </>
      )
    case 'nor2':
      return (
        <>
          <path d="M0 20H20.4M0 40H20.4M60 30H80M40 0V19.3M40 60V40.7" {...line} />
          <path d="M18 14Q40 14 52 30Q40 46 18 46Q26 30 18 14Z" {...tinted(kind)} />
          <circle cx={56} cy={30} r={4} {...line} fill="#ffffff" />
          {showText && <Text x={46} y={10} anchor="start">{ref}</Text>}
        </>
      )
    case 'nmos':
    case 'pmos': {
      const p = kind === 'pmos'
      return (
        <>
          <path d={p ? 'M0 30H10' : 'M0 30H16'} {...line} />
          {p && <circle cx={13} cy={30} r={3} {...line} fill="#ffffff" />}
          <path d="M16 18V42" {...line} strokeWidth={2} />
          <path d="M22 16V44" {...line} strokeWidth={2} />
          <path d="M22 20H40V0M22 40H40V60M22 30H60" {...line} />
          <path d={p ? 'M27 27L32 30L27 33' : 'M31 27L26 30L31 33'} {...line} />
          {showText && (
            <>
              <Text x={44} y={10} anchor="start" size={7} weight={500} color={MUTED}>{p ? 'S' : 'D'}</Text>
              <Text x={44} y={56} anchor="start" size={7} weight={500} color={MUTED}>{p ? 'D' : 'S'}</Text>
              <Text x={44} y={25} anchor="start">{ref}</Text>
            </>
          )}
        </>
      )
    }
    case 'moscap':
      return (
        <>
          <path d="M0 30H26M33 30H60M30 60V48M23 48H37" {...line} />
          <path d="M26 18V42" {...line} strokeWidth={2.25} strokeLinecap="butt" />
          <path d="M35 18Q31 30 35 42" {...line} strokeWidth={2.25} />
          {showText && (
            <>
              <Text x={30} y={10}>{ref}</Text>
              <Text x={34} y={58} anchor="start" size={7} weight={500} color={MUTED}>B</Text>
            </>
          )}
        </>
      )
    case 'gabasecell':
      return (
        <>
          <path
            d="M0 60H20M0 80H20M80 40H100M80 60H100M80 80H100M80 100H100M40 0V20M60 0V20M40 120V140M60 120V140"
            {...line}
          />
          <rect x={20} y={20} width={60} height={100} rx={2} {...tinted(kind)} />
          {showText && (
            <>
              <Text x={23} y={63} anchor="start" size={7} weight={500} color={MUTED}>G1</Text>
              <Text x={23} y={83} anchor="start" size={7} weight={500} color={MUTED}>G2</Text>
              <Text x={77} y={43} anchor="end" size={7} weight={500} color={MUTED}>P1</Text>
              <Text x={77} y={63} anchor="end" size={7} weight={500} color={MUTED}>P3</Text>
              <Text x={77} y={83} anchor="end" size={7} weight={500} color={MUTED}>N1</Text>
              <Text x={77} y={103} anchor="end" size={7} weight={500} color={MUTED}>N3</Text>
              <Text x={40} y={30} size={7} weight={500} color={MUTED}>P2</Text>
              <Text x={60} y={30} size={7} weight={500} color={MUTED}>VDD</Text>
              <Text x={40} y={116} size={7} weight={500} color={MUTED}>N2</Text>
              <Text x={60} y={116} size={7} weight={500} color={MUTED}>VSS</Text>
              <Text x={50} y={48} size={8.5}>{ref}</Text>
              <Text x={50} y={75} size={11} weight={700} color={MUTED}>GA</Text>
            </>
          )}
        </>
      )
    case 'ground':
      return (
        <>
          <path d="M10 0V8" {...line} />
          <path d="M1 8H19M5 12.5H15M8.5 17H11.5" {...line} strokeWidth={1.75} />
        </>
      )
    case 'vdd':
      return (
        <>
          <path d="M10 30V10" {...line} />
          <path d="M2 10H18" {...line} strokeWidth={2.25} />
          {/* 電圧は全 VDD 記号で共通（プロパティパネルで編集）なので記号には出さない */}
          {showText && <Text x={10} y={6} size={8} weight={700}>VDD</Text>}
        </>
      )
    case 'net_label': {
      const w = geom.width
      const flip = !!data.flip
      return (
        <>
          <path
            d={flip ? `M${w} 10L${w - 8} 2H0V18H${w - 8}Z` : `M0 10L8 2H${w}V18H8Z`}
            {...line}
            strokeWidth={1}
            fill="#ffffff"
          />
          {showText && (
            <Text x={flip ? w - 10 : 10} y={13.5} anchor={flip ? 'end' : 'start'}>
              {netLabelText(data)}
            </Text>
          )}
        </>
      )
    }
    case 'ga_io_in':
    case 'ga_io_out': {
      const w = geom.width
      return (
        <>
          <path d={`M0 2H${w - 8}L${w} 10L${w - 8} 18H0Z`} {...tinted(kind)} strokeWidth={1.25} fillOpacity={0.18} />
          {showText && <Text x={(w - 6) / 2} y={13.5}>{ioPadText(data)}</Text>}
        </>
      )
    }
  }
}

function SourceGlyph({ kind }: { kind: ComponentKind }) {
  switch (kind) {
    case 'voltage_dc':
      return <path d="M17 22H23M20 19V25M17 38H23" {...line} strokeWidth={1.25} />
    case 'voltage_sin':
      return <path d="M12 30C15 21 17 21 20 30S25 39 28 30" {...line} strokeWidth={1.25} />
    case 'voltage_pulse':
      return <path d="M11 35H15V24H24V35H29" {...line} strokeWidth={1.25} />
    case 'voltage_ac':
      return (
        <>
          <path d="M13 27C15.5 21 17.5 21 20 27S24.5 33 27 27" {...line} strokeWidth={1.25} />
          <Text x={20} y={39} size={6.5} weight={700}>AC</Text>
        </>
      )
    case 'current_dc':
      return <path d="M20 21V38M16 33L20 39L24 33" {...line} strokeWidth={1.25} />
    default:
      return null
  }
}

/** キャンバス上のシンボル（ノードと同寸、文字ははみ出し可）。 */
export function SchematicSymbol({ data }: { data: CircuitNodeData }) {
  const geom = symbolGeom(data)
  return (
    <svg
      width={geom.width}
      height={geom.height}
      viewBox={`0 0 ${geom.width} ${geom.height}`}
      className="pointer-events-none absolute inset-0 overflow-visible"
      aria-hidden
    >
      <SymbolBody data={data} geom={geom} showText />
    </svg>
  )
}

/** 部品ライブラリ用のアイコン（文字なし、枠に収まるよう縮小）。 */
export function SymbolPreview({
  kind,
  className,
}: {
  kind: ComponentKind
  className?: string
}) {
  const data: CircuitNodeData = { kind, ref: '', value: '', netName: 'net' }
  const geom = symbolGeom(data)
  const pad = 2
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${geom.width + pad * 2} ${geom.height + pad * 2}`}
      className={className}
      aria-hidden
    >
      <SymbolBody data={data} geom={geom} showText={false} />
    </svg>
  )
}
