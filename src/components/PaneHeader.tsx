import type { ReactNode } from 'react'

/** ペインの見出し行（波形・コンソールなど）。罫線 1 本で区切り、右側に補足を置く。 */
export function PaneHeader({
  title,
  children,
  compact,
}: {
  title: string
  children?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-3 ${
        compact ? 'h-8' : 'h-10'
      }`}
    >
      <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      {children && (
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-light">
          {children}
        </div>
      )}
    </div>
  )
}
