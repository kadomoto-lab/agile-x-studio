import { useRef, useState, type ChangeEvent } from 'react'
import { LayoutGrid, FileCode2, Save, Layers, Loader2, Download, FolderOpen } from 'lucide-react'
import { CodeEditor } from './CodeEditor'
import { SchematicEditor } from './SchematicEditor'
import { GdsViewer } from './GdsViewer'
import type { SchematicDocument } from '../schematic/types'
import type { SchematicUndoPoint } from '../hooks/useCircuitProject'
import { schematicToNetlist } from '../schematic/netlist'
import { parseSchematicFile, schematicFilename, SchematicFileError } from '../schematic/file'
import { downloadSchematic } from '../schematic/saveFile'
import { syncLayout } from '../lib/layoutApi'
import { messages } from '../i18n'

export type DesignTab = 'schematic' | 'netlist' | 'gds'

type DesignPaneProps = {
  activeTab: DesignTab
  onTabChange: (tab: DesignTab) => void
  schematic: SchematicDocument
  /** 回路図を取り込み直すたびに増える。変わると全体表示に戻す */
  schematicRevision: number
  onSchematicChange: (doc: SchematicDocument, undo?: SchematicUndoPoint) => void
  onSchematicImport: (doc: SchematicDocument, fileName: string) => void
  schematicFileName: string | null
  onSchematicFileSaved: (fileName: string) => void
  onSchematicUndo: () => void
  onSchematicRedo: () => void
  netlist: string
  onNetlistChange: (value: string) => void
  schematicDirty: boolean
  layoutUnsynced: boolean
  gdsRevision: number
  onSaveFromSchematic: (netlist: string) => void
  onLayoutSynced: (revision: number, syncedNetlist: string) => void
  readOnly?: boolean
}

export function DesignPane({
  activeTab,
  onTabChange,
  schematic,
  schematicRevision,
  onSchematicChange,
  onSchematicImport,
  schematicFileName,
  onSchematicFileSaved,
  onSchematicUndo,
  onSchematicRedo,
  netlist,
  onNetlistChange,
  schematicDirty,
  layoutUnsynced,
  gdsRevision,
  onSaveFromSchematic,
  onLayoutSynced,
  readOnly,
}: DesignPaneProps) {
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportName, setExportName] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const saveDialog = useRef<HTMLDialogElement>(null)

  const handleExport = () => {
    setFileError(null)
    setExportName(schematicFilename(schematicFileName ?? schematic.title))
    saveDialog.current?.showModal()
  }

  const handleDownload = () => {
    try {
      const name = schematicFilename(exportName)
      downloadSchematic(schematic, name)
      onSchematicFileSaved(name)
      saveDialog.current?.close()
    } catch {
      saveDialog.current?.close()
      setFileError(messages.design.schematicExportFailed)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setFileError(null)
    try {
      const doc = parseSchematicFile(await file.text())
      onSchematicImport(doc, file.name)
      setSaveError(null)
    } catch (error) {
      setFileError(error instanceof SchematicFileError
        ? messages.design.schematicFileInvalid
        : messages.design.schematicImportFailed)
    } finally {
      setImporting(false)
    }
  }

  const runLayoutSync = async (netlistText: string) => {
    const layout = await syncLayout(netlistText)
    onLayoutSynced(layout.revision, netlistText)
    return layout
  }

  const handleSaveFromSchematic = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const generated = schematicToNetlist(schematic)
      onSaveFromSchematic(generated)
      const layout = await runLayoutSync(generated)
      setSaveError(null)
      return layout.path
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setSaving(false)
    }
  }

  const handleSyncLayoutFromNetlist = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await runLayoutSync(netlist)
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-stretch justify-between gap-3 border-b border-hairline bg-surface pl-1 pr-2">
        <div role="tablist" className="flex items-stretch">
          <TabButton
            active={activeTab === 'schematic'}
            onClick={() => onTabChange('schematic')}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label={messages.design.tabSchematic}
          />
          <TabButton
            active={activeTab === 'netlist'}
            onClick={() => onTabChange('netlist')}
            icon={<FileCode2 className="h-3.5 w-3.5" />}
            label={messages.design.tabNetlist}
            badge={
              schematicDirty ? messages.design.badgeUnsynced : undefined
            }
          />
          <TabButton
            active={activeTab === 'gds'}
            onClick={() => onTabChange('gds')}
            icon={<Layers className="h-3.5 w-3.5" />}
            label={messages.design.tabLayout}
            badge={
              layoutUnsynced ? messages.design.badgeUnsynced : undefined
            }
          />
        </div>

        {activeTab === 'schematic' && (
          <div className="flex items-center gap-2.5">
            {schematicDirty && <StatusMark label={messages.design.modified} />}
            {saveError && (
              <span className="max-w-[240px] truncate text-[11px] text-danger" title={saveError}>
                {saveError}
              </span>
            )}
            <button
              type="button"
              disabled={readOnly || saving || importing}
              onClick={() => void handleSaveFromSchematic()}
              className={SECONDARY_BTN}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {messages.design.syncToNetlistAndLayout}
            </button>
          </div>
        )}

        {(activeTab === 'netlist' || activeTab === 'gds') && (
          <div className="flex items-center gap-2.5">
            {saveError && (
              <span className="max-w-[240px] truncate text-[11px] text-danger" title={saveError}>
                {saveError}
              </span>
            )}
            <button
              type="button"
              disabled={readOnly || saving || importing}
              onClick={() => void handleSyncLayoutFromNetlist()}
              className={SECONDARY_BTN}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              {messages.design.syncLayout}
            </button>
          </div>
        )}
      </div>

      {activeTab === 'schematic' && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-surface px-3 py-1.5">
          <button type="button" className={SECONDARY_BTN} onClick={handleExport} disabled={importing}>
            <Download className="h-3.5 w-3.5" />
            {messages.design.saveSchematic}
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            onClick={() => fileInput.current?.click()}
            disabled={readOnly || saving || importing}
            title={messages.design.importSchematicHint}
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            {messages.design.importSchematic}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label={messages.design.importSchematic}
            className="hidden"
            onChange={(event) => void handleImport(event)}
            disabled={readOnly || saving || importing}
          />
          {fileError && <span role="alert" className="text-[11px] text-danger">{fileError}</span>}
          <dialog
            ref={saveDialog}
            aria-label={messages.design.saveSchematic}
            className="m-auto w-[min(420px,calc(100%-2rem))] rounded-lg border border-hairline bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/40"
          >
            <form onSubmit={(event) => { event.preventDefault(); handleDownload() }}>
              <label className="block text-xs">
                {messages.design.fileName}
                <input
                  autoFocus
                  required
                  value={exportName}
                  onChange={(event) => setExportName(event.target.value)}
                  className="mt-1.5 h-9 w-full rounded-md border border-hairline bg-surface px-2.5 text-sm outline-none focus:border-accent"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className={SECONDARY_BTN} onClick={() => saveDialog.current?.close()}>{messages.design.cancel}</button>
                <button type="submit" className={SECONDARY_BTN} disabled={!exportName.trim()}>{messages.design.confirmSave}</button>
              </div>
            </form>
          </dialog>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {activeTab === 'schematic' && (
          <SchematicEditor
            key={schematicRevision}
            document={schematic}
            onDocumentChange={onSchematicChange}
            onUndo={onSchematicUndo}
            onRedo={onSchematicRedo}
          />
        )}
        {activeTab === 'netlist' && (
          <CodeEditor
            value={netlist}
            onChange={onNetlistChange}
            readOnly={readOnly}
          />
        )}
        {activeTab === 'gds' && <GdsViewer revision={gdsRevision} />}
      </div>
    </div>
  )
}

/** 二次的な操作（同期）のボタン。主ボタン（シミュレーション実行）より控えめにする */
const SECONDARY_BTN =
  'flex h-7 items-center gap-1.5 self-center rounded-md border border-accent/45 bg-surface px-2.5 text-[12px] font-semibold text-accent-ink transition-colors hover:border-accent hover:bg-accent/[0.06] disabled:cursor-not-allowed disabled:opacity-45'

/** 「未同期」「変更あり」の目印（色だけに頼らず文字でも示す） */
function StatusMark({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-highlight-ink">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-highlight" />
      {label}
    </span>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center gap-1.5 px-3 text-[13px] transition-colors after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:rounded-full after:content-[''] ${
        active
          ? 'font-semibold text-foreground after:bg-accent'
          : 'text-muted hover:text-foreground after:bg-transparent'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-muted-light'}>{icon}</span>
      {label}
      {badge && <StatusMark label={badge} />}
    </button>
  )
}
