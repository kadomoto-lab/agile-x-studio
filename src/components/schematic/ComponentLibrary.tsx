import type { ComponentKind } from '../../schematic/types'
import { COMPONENT_LIBRARY } from '../../schematic/library'
import { messages } from '../../i18n'
import { SymbolPreview } from './SchematicSymbol'

const DRAG_KIND = 'application/circuit-component'

type ComponentLibraryProps = {
  onAdd: (kind: ComponentKind) => void
}

const CATEGORIES = [
  { id: 'passive' as const, labelKey: 'categoryPassive' as const },
  { id: 'source' as const, labelKey: 'categorySource' as const },
  { id: 'digital' as const, labelKey: 'categoryDigital' as const },
  { id: 'other' as const, labelKey: 'categoryOther' as const },
]

export function ComponentLibrary({ onAdd }: ComponentLibraryProps) {
  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-surface-muted">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {messages.library.title}
        </h2>
        <p className="mt-0.5 text-[10px] text-muted-light">
          {messages.library.hint}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {CATEGORIES.map((cat) => {
          const items = COMPONENT_LIBRARY.filter((c) => c.category === cat.id)
          return (
            <div key={cat.id} className="mb-3">
              <div className="mb-1 px-1 text-[10px] font-medium text-muted">
                {messages.library[cat.labelKey]}
              </div>
              <div className="flex flex-col gap-1">
                {items.map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_KIND, item.kind)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => onAdd(item.kind)}
                    className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-accent/50 hover:bg-surface-inset"
                    title={item.description}
                  >
                    <span className="flex h-8 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted p-0.5 group-hover:bg-accent/10">
                      <SymbolPreview kind={item.kind} className="max-h-full max-w-full" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">
                        {item.label}
                      </div>
                      <div className="truncate font-mono text-[9px] text-muted">
                        {item.defaultValue}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export { DRAG_KIND }
