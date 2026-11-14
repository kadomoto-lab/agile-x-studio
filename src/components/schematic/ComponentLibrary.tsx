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
    <aside className="flex w-44 shrink-0 flex-col border-r border-hairline bg-surface-muted">
      <div className="border-b border-hairline px-3 pb-2 pt-2.5">
        <h2 className="text-[13px] font-semibold text-foreground">
          {messages.library.title}
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-light">
          {messages.library.hint}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {CATEGORIES.map((cat) => {
          const items = COMPONENT_LIBRARY.filter((c) => c.category === cat.id)
          return (
            <section key={cat.id} className="pt-3">
              {/* 分類名の後ろに罫線を引いて、カードではなく紙面の小見出しとして区切る */}
              <h3 className="mb-1 flex items-center gap-2 px-1.5 text-[11px] font-semibold text-muted after:h-px after:flex-1 after:bg-hairline after:content-['']">
                {messages.library[cat.labelKey]}
              </h3>
              <ul className="flex flex-col">
                {items.map((item) => (
                  <li key={item.kind}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_KIND, item.kind)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={() => onAdd(item.kind)}
                      className="group flex w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface active:cursor-grabbing active:bg-accent/[0.08]"
                      title={item.description}
                    >
                      <span className="flex h-7 w-9 shrink-0 items-center justify-center text-muted transition-colors group-hover:text-accent">
                        <SymbolPreview kind={item.kind} className="max-h-full max-w-full" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium leading-tight text-foreground">
                          {item.label}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] leading-tight text-muted-light">
                          {item.defaultValue}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </aside>
  )
}

export { DRAG_KIND }
