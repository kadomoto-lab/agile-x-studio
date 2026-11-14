import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import uPlot from 'uplot'
import type { WaveformData, WaveformTrace } from '../lib/waveform'
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

function formatAxisValue(v: number): string {
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 1e6 || abs < 1e-3) return v.toExponential(2)
  if (abs >= 100) return v.toFixed(1)
  return v.toPrecision(4)
}

const AXIS_OPTS = {
  stroke: '#666666',
  grid: { stroke: '#d9d9d9', width: 1 },
  values: (_u: uPlot, ticks: number[]) => ticks.map(formatAxisValue),
}

function TracePane({
  x,
  trace,
  xLabel,
  xMin,
  xMax,
}: {
  x: number[]
  trace: WaveformTrace
  xLabel: string
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
          { ...AXIS_OPTS, size: 36, grid: { ...AXIS_OPTS.grid, show: true } },
          { ...AXIS_OPTS, stroke: trace.color, size: 50, grid: { show: false } },
        ],
        legend: { show: false },
        cursor: {
          drag: { x: true, y: false },
          sync: {
            key: WAVE_SYNC_KEY,
            scales: ['x', null],
          },
        },
        padding: [8, 8, 0, 8],
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
  }, [x, trace, xLabel, xMin, xMax])

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
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-muted">
          <svg
            className="h-8 w-8 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 13h2l3-9 4 18 3-9h2"
            />
          </svg>
        </div>
        <p className="text-sm font-medium">{messages.waveform.emptyTitle}</p>
        <p className="max-w-xs text-center text-xs">
          {messages.waveform.emptyHint}
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" aria-busy={simulating}>
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
        {waveform.traces.map((trace) => {
          const isOn = visible.has(trace.name)
          return (
            <button
              key={trace.name}
              type="button"
              onClick={() => toggleTrace(trace.name)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                isOn
                  ? 'border-accent/40 bg-accent/10 text-foreground'
                  : 'border-border bg-transparent text-muted'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: isOn ? trace.color : '#cccccc' }}
              />
              {trace.name}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        {activeTraces.map((trace) => (
          <div
            key={trace.name}
            className="flex min-h-[88px] flex-1 flex-col border-b border-border/60 last:border-b-0"
          >
            <div
              className="shrink-0 px-1 font-mono text-[10px] font-semibold"
              style={{ color: trace.color }}
            >
              {trace.name}
            </div>
            <TracePane
              x={waveform.x}
              trace={trace}
              xLabel={waveform.xLabel}
              xMin={xRange.min}
              xMax={xRange.max}
            />
          </div>
        ))}
      </div>

      {simulating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80 backdrop-blur-[1px]">
          <SimulatingOverlay compact />
        </div>
      )}
    </div>
  )
}
