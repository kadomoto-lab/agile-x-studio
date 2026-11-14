import { messages } from '../i18n'

type ConsoleProps = {
  lines: string[]
}

export function Console({ lines }: ConsoleProps) {
  return (
    <div className="h-full overflow-auto bg-surface-inset px-3 py-2 font-mono text-xs leading-relaxed text-muted">
      {lines.length === 0 ? (
        <span className="text-muted-light">{messages.console.placeholder}</span>
      ) : (
        lines.map((line, i) => (
          <div
            key={`${i}-${line.slice(0, 24)}`}
            className={
              line.startsWith('ERROR') || line.includes('error')
                ? 'text-danger'
                : undefined
            }
          >
            {line}
          </div>
        ))
      )}
    </div>
  )
}
