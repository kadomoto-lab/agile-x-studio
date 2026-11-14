import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import uPlot from 'uplot'
import {
  formatSiTicks,
  traceUnit,
  type WaveformData,
  type WaveformTrace,
} from '../lib/waveform'
import { messages } from '../i18n'

const WAVE_SYNC_KEY = 'agilex-waveform'

type WaveformViewerProps = {
  waveform: WaveformData | null
  simulating?: boolean
}

function SimulatingOverlay({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-accent ${
        compact ? 'gap-2' : 'gap-3'
      }`}
    >
      <Loader2 className={`animate-spin ${compact ? 'h-6 w-6' : 'h-8 w-8'}`} />
      <p className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
        {messages.waveform.simulating}
      </p>
    </div>
  )
}

// 目盛りは等幅の数字で、ネイビー寄りの控えめな色にする（src/index.css のトークンと同じ値）
const AXIS_FONT = '11px "IBM Plex Mono", ui-monospace, monospace'
const AXIS_OPTS = {
  stroke: '#4c5b6a',
  font: AXIS_FONT,
  grid: { stroke: '#e1e7ed', width: 1 },
  ticks: { stroke: '#cfd8e1', width: 1, size: 4 },
}

function TracePane({
  x,
  trace,
  xLabel,
  xUnit,
  xMin,
  xMax,
}: {
  x: number[]
  trace: WaveformTrace
  xLabel: string
  xUnit: string
  xMin: number
  xMax: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    plotRef.current?.destroy()

    const width = container.clientWidth || 400
    const height = container.clientHeight || 120

    const plot = new uPlot(
      {
        width,
        height,
        series: [
          { label: xLabel },
          { label: trace.name, stroke: trace.color, width: 2 },
        ],
        scales: {
          x: { time: false, min: xMin, max: xMax },
        },
        axes: [
          {
            ...AXIS_OPTS,
            size: 30,
            grid: { ...AXIS_OPTS.grid, show: true },
            values: (_u: uPlot, ticks: number[]) => formatSiTicks(ticks, xUnit),
          },
          {
            ...AXIS_OPTS,
            size: 64,
            grid: { ...AXIS_OPTS.grid, show: true },
            values: (_u: uPlot, ticks: number[]) => formatSiTicks(ticks, traceUnit(trace.name)),
          },
        ],
        legend: { show: false },
        cursor: {
          drag: { x: true, y: false },
          sync: {
            key: WAVE_SYNC_KEY,
            scales: ['x', null],
          },
        },
        padding: [6, 28, 0, 4],
      },
      [x, trace.values],
      container,
    )

    plotRef.current = plot

    const observer = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w > 0 && h > 0) plot.setSize({ width: w, height: h })
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [x, trace, xLabel, xUnit, xMin, xMax])

  return <div ref={containerRef} className="min-h-0 flex-1" />
}

export function WaveformViewer({ waveform, simulating }: WaveformViewerProps) {
  const [visible, setVisible] = useState<Set<string>>(new Set())

  // ロケール切替（ラベルのみ変化）では選択を保つため traces に依存させる。
  // 新しい結果が来たら全トレースを表示状態に戻す（effect 内 setState による
  // 余分な再描画を避け、レンダー中に前回値と比較して更新する）。
  const traces = waveform?.traces
  const [prevTraces, setPrevTraces] = useState(traces)
  if (traces !== prevTraces) {
    setPrevTraces(traces)
    if (traces) {
      setVisible(new Set(traces.map((t) => t.name)))
    }
  }

  const activeTraces = useMemo(() => {
    if (!waveform) return []
    return waveform.traces.filter((t) => visible.has(t.name))
  }, [waveform, visible])

  const xRange = useMemo(() => {
    if (!waveform || waveform.x.length === 0) return { min: 0, max: 1 }
    return { min: waveform.x[0], max: waveform.x[waveform.x.length - 1] }
  }, [waveform])

  const toggleTrace = (name: string) => {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        if (next.size > 1) next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  if (!waveform) {
    if (simulating) {
      return (
        <div
          className="flex h-full flex-col items-center justify-center bg-surface"
          aria-busy="true"
        >
          <SimulatingOverlay />
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-muted">
        {/* 方眼の上に方形波を描いた見本（ここに波形が出ることを示す） */}
        <svg
          aria-hidden
          className="mb-2 h-16 w-44 text-border-strong"
          viewBox="0 0 176 64"
          fill="none"
        >
          <path
            d="M0 16h176M0 32h176M0 48h176M44 0v64M88 0v64M132 0v64"
            stroke="var(--color-hairline)"
          />
          <path
            d="M4 48h28v-32h40v32h40v-32h40v32h20"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-[14px] font-semibold text-foreground">
          {messages.waveform.emptyTitle}
        </p>
        <p className="max-w-xs text-center text-[12.5px] leading-relaxed">
          {messages.waveform.emptyHint}
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" aria-busy={simulating}>
      <div className="flex max-h-[40%] flex-wrap gap-1.5 overflow-y-auto border-b border-hairline px-3 py-2">
        {waveform.traces.map((trace) => {
          const isOn = visible.has(trace.name)
          return (
            <button
              key={trace.name}
              type="button"
              onClick={() => toggleTrace(trace.name)}
              aria-pressed={isOn}
              className={`flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[11.5px] transition-colors ${
                isOn
                  ? 'border-border bg-surface text-foreground hover:border-border-strong'
                  : 'border-transparent bg-transparent text-muted-light hover:text-muted'
              }`}
            >
              {/* 凡例と同じく、線の見本で色を示す（非表示は中抜き） */}
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={
                  isOn
                    ? { backgroundColor: trace.color }
                    : { boxShadow: 'inset 0 0 0 1px var(--color-border-strong)', height: 4 }
                }
              />
              {trace.name}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {activeTraces.map((trace) => (
          <div
            key={trace.name}
            className="flex min-h-[96px] flex-1 flex-col border-b border-hairline pt-1.5 last:border-b-0"
          >
            <div className="flex shrink-0 items-center gap-1.5 px-1 font-mono text-[11px] font-medium text-foreground">
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ backgroundColor: trace.color }}
              />
              {trace.name}
            </div>
            <TracePane
              x={waveform.x}
              trace={trace}
              xLabel={waveform.xLabel}
              xUnit={waveform.xUnit}
              xMin={xRange.min}
              xMax={xRange.max}
            />
          </div>
        ))}
      </div>

      {simulating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/85">
          <SimulatingOverlay compact />
        </div>
      )}
    </div>
  )
}
