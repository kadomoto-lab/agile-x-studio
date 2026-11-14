import { useState } from 'react'
import { LayoutGrid, FileCode2, Save, Layers, Loader2 } from 'lucide-react'
import { CodeEditor } from './CodeEditor'
import { SchematicEditor } from './SchematicEditor'
import { GdsViewer } from './GdsViewer'
import type { SchematicDocument } from '../schematic/types'
import type { SchematicUndoPoint } from '../hooks/useCircuitProject'
import { schematicToNetlist } from '../schematic/netlist'
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
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface-muted px-2">
        <div className="flex rounded-lg border border-border bg-surface p-0.5">
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
          <div className="flex items-center gap-2">
            {schematicDirty && (
              <span className="text-[10px] text-highlight">
                {messages.design.modified}
              </span>
            )}
            {saveError && (
              <span className="max-w-[240px] truncate text-[10px] text-danger">
                {saveError}
              </span>
            )}
            <button
              type="button"
              disabled={readOnly || saving}
              onClick={() => void handleSaveFromSchematic()}
              className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
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
          <div className="flex items-center gap-2">
            {saveError && (
              <span className="max-w-[240px] truncate text-[10px] text-danger">
                {saveError}
              </span>
            )}
            <button
              type="button"
              disabled={readOnly || saving}
              onClick={() => void handleSyncLayoutFromNetlist()}
              className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
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
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-surface-raised text-foreground shadow-sm'
          : 'text-muted hover:text-accent'
      }`}
    >
      {icon}
      {label}
      {badge && (
        <span className="rounded-full bg-highlight/20 px-1.5 text-[9px] text-highlight">
          {badge}
        </span>
      )}
    </button>
  )
}
