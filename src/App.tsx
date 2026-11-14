import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Play, Loader2 } from 'lucide-react'
import { DesignPane } from './components/DesignPane'
import { WaveformViewer } from './components/WaveformViewer'
import { Console } from './components/Console'
import { LanguageToggle } from './components/LanguageToggle'
import { initEngine, runNetlist, type RunResult } from './lib/simulation'
import { resultToWaveform, waveformLabels } from './lib/waveform'
import { useCircuitProject } from './hooks/useCircuitProject'
import { messages, useLocale } from './i18n'
import { SAMPLE_IDS, type SampleId } from './samples/circuits'

type AppStatus = 'idle' | 'loading' | 'ready' | 'error'

const MIN_RUNNING_DISPLAY_MS = 400

function waitForUiPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0)
      })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const LOGO_URL = `${import.meta.env.BASE_URL}agilex-logo-header.svg`

function sampleLabel(id: SampleId): string {
  switch (id) {
    case 'ring31':
      return messages.app.sampleRing31
    case 'inv2Pulse':
      return messages.app.sampleInv2Pulse
    case 'adder4':
      return messages.app.sampleAdder4
  }
}

export default function App() {
  const project = useCircuitProject()
  const locale = useLocale()
  // 軸ラベルはロケール依存のため、生の結果を保持してラベルだけ切替時に付け直す
  // （traces の同一性を保ち、波形の表示/非表示選択をリセットしない）
  const [simResult, setSimResult] = useState<RunResult['data'] | null>(null)
  const baseWaveform = useMemo(
    () => (simResult ? resultToWaveform(simResult) : null),
    [simResult],
  )
  const waveform = useMemo(
    () =>
      simResult && baseWaveform
        ? { ...baseWaveform, ...waveformLabels(simResult) }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simResult, baseWaveform, locale],
  )
  const [consoleLines, setConsoleLines] = useState<string[]>([])
  // 起動直後はサーバ側シミュレータの確認中
  const [status, setStatus] = useState<AppStatus>('loading')
  const [isSimulating, setIsSimulating] = useState(false)
  const [splitRatio, setSplitRatio] = useState(48)
  const [consoleHeight, setConsoleHeight] = useState(120)
  const [gdsRevision, setGdsRevision] = useState(0)
  const [layoutSyncedNetlist, setLayoutSyncedNetlist] = useState<string | null>(
    null,
  )
  const draggingSplit = useRef(false)
  const draggingConsole = useRef(false)

  const simLockRef = useRef(false)

  const appendLog = useCallback((line: string) => {
    setConsoleLines((prev) => [...prev.slice(-200), line])
  }, [])

  const runSimulation = useCallback(async () => {
    if (simLockRef.current) return
    simLockRef.current = true
    const startedAt = performance.now()

    flushSync(() => setIsSimulating(true))
    appendLog(messages.app.logSimStart)

    await waitForUiPaint()

    try {
      const { data, info, errors } = await runNetlist(project.netlist)

      if (info.trim()) {
        info
          .split('\n')
          .filter(Boolean)
          .forEach((l) => appendLog(l))
      }

      errors.forEach((e) => appendLog(`ERROR: ${e}`))

      if (data.data.every((series) => series.values.length === 0)) {
        appendLog('ERROR: Simulation returned no waveform data')
        setStatus('error')
        return
      }

      const wf = resultToWaveform(data)
      if (wf.traces.length === 0 || wf.x.length === 0) {
        appendLog('ERROR: No plottable signals in simulation result')
        setStatus('error')
        return
      }
      appendLog(
        messages.app.logSimComplete(
          wf.traces.length,
          wf.x.length,
          data.dataType,
        ),
      )

      const remaining = MIN_RUNNING_DISPLAY_MS - (performance.now() - startedAt)
      if (remaining > 0) {
        await sleep(remaining)
      }

      flushSync(() => setIsSimulating(false))
      setSimResult(data)
      setStatus('ready')
    } catch (err) {
      flushSync(() => setIsSimulating(false))
      const message = err instanceof Error ? err.message : String(err)
      appendLog(`ERROR: ${message}`)
      setStatus('error')
    } finally {
      simLockRef.current = false
    }
  }, [project.netlist, appendLog])

  useEffect(() => {
    // サーバ側シミュレータ（ngspice）の確認。`npm run dev` では Vite と API が
    // 同時に起動し API の準備が遅れるため、しばらく再試行する。
    let cancelled = false
    const check = async () => {
      appendLog(messages.app.logEngineLoading)
      const maxAttempts = 15
      for (let attempt = 1; ; attempt++) {
        try {
          const sim = await initEngine()
          if (cancelled) return
          appendLog(messages.app.logEngineReady(sim.version || sim.simulator))
          setStatus('idle')
          return
        } catch (err) {
          if (cancelled) return
          if (attempt >= maxAttempts) {
            appendLog(
              messages.app.logEngineInitFailed(
                err instanceof Error ? err.message : String(err),
              ),
            )
            setStatus('error')
            return
          }
          await sleep(2000)
        }
      }
    }
    void check()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (draggingSplit.current) {
        const ratio = (e.clientX / window.innerWidth) * 100
        setSplitRatio(Math.min(72, Math.max(30, ratio)))
      }
      if (draggingConsole.current) {
        const fromBottom = window.innerHeight - e.clientY
        setConsoleHeight(Math.min(280, Math.max(60, fromBottom)))
      }
    }
    const onMouseUp = () => {
      draggingSplit.current = false
      draggingConsole.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const isBusy = isSimulating || status === 'loading'
  // 直前の実行・初期化が失敗していても再実行できるようにする
  // （以前は status === 'error' で実行ボタンが恒久的に無効化されていた）
  const canRun = !isBusy

  const layoutUnsynced =
    project.schematicDirty ||
    layoutSyncedNetlist === null ||
    project.netlist !== layoutSyncedNetlist

  return (
    <div className="flex h-full flex-col bg-surface-muted">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-ax-navy-muted bg-ax-navy px-4 shadow-md">
        <div className="flex items-center gap-3">
          <img
            src={LOGO_URL}
            alt="Agile-X"
            className="h-10 w-auto"
          />
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-on-navy">
              Agile-X Studio
            </h1>
          </div>
          <label className="ml-2 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-on-navy/70">
              {messages.app.sampleCircuit}
            </span>
            <select
              value={project.sampleId}
              disabled={isBusy}
              onChange={(e) => {
                const id = e.target.value as SampleId
                if (id === project.sampleId) return
                project.loadSample(id)
                setLayoutSyncedNetlist(null)
                setSimResult(null)
                appendLog(messages.app.logSampleLoaded(sampleLabel(id)))
              }}
              className="rounded-md border border-ax-navy-muted bg-ax-navy px-2 py-1 text-xs text-on-navy shadow-sm outline-none focus:border-ax-blue focus:ring-1 focus:ring-ax-blue disabled:opacity-40"
            >
              {SAMPLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {sampleLabel(id)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <LanguageToggle />
          <button
            type="button"
            disabled={!canRun}
            onClick={runSimulation}
            className="flex items-center gap-2 rounded-lg bg-ax-blue px-4 py-1.5 text-sm font-semibold text-on-navy shadow-lg shadow-ax-blue/30 transition-all hover:bg-ax-blue-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSimulating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
            {isSimulating
              ? messages.app.running
              : messages.app.runSimulation}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <section
            className="flex min-w-0 flex-col border-r border-border bg-surface"
            style={{ width: `${splitRatio}%` }}
          >
            <DesignPane
              activeTab={project.designTab}
              onTabChange={project.setDesignTab}
              schematic={project.schematic}
              schematicRevision={project.importRevision}
              onSchematicChange={project.onSchematicChange}
              onSchematicUndo={project.undoSchematic}
              onSchematicRedo={project.redoSchematic}
              netlist={project.netlist}
              onNetlistChange={project.onNetlistChange}
              schematicDirty={project.schematicDirty}
              layoutUnsynced={layoutUnsynced}
              gdsRevision={gdsRevision}
              onLayoutSynced={(revision, syncedNetlist) => {
                setGdsRevision(revision)
                setLayoutSyncedNetlist(syncedNetlist)
              }}
              onSaveFromSchematic={(nl) => {
                project.saveFromSchematic(nl)
                appendLog(messages.app.logSchematicSynced)
              }}
              readOnly={isBusy}
            />
          </section>

          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent/60"
            onMouseDown={() => {
              draggingSplit.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
          />

          <section className="flex min-w-0 flex-1 flex-col bg-surface">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted">
                {messages.app.waveform}
              </span>
              {waveform && (
                <span className="text-[10px] text-muted">
                  {messages.app.waveformPts(
                    waveform.x.length,
                    waveform.traces.length,
                  )}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <WaveformViewer waveform={waveform} simulating={isSimulating} />
            </div>
          </section>
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-accent/60"
          onMouseDown={() => {
            draggingConsole.current = true
            document.body.style.cursor = 'row-resize'
            document.body.style.userSelect = 'none'
          }}
        />

        <div
          className="shrink-0 border-t border-border bg-surface"
          style={{ height: consoleHeight }}
        >
          <div className="flex h-7 items-center border-b border-border px-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted">
              {messages.app.console}
            </span>
          </div>
          <div className="h-[calc(100%-1.75rem)]">
            <Console lines={consoleLines} />
          </div>
        </div>
      </div>
    </div>
  )
}
