import { useEffect, useRef } from 'react'
import { messages } from '../i18n'

type ConsoleProps = {
  lines: string[]
}

/** 行の種類: アプリの進行（> で始まる）、エラー、ngspice などの詳細ログ */
function lineTone(line: string): string {
  if (line.startsWith('ERROR') || /\berror\b/i.test(line)) return 'text-danger'
  if (line.startsWith('>')) return 'text-foreground'
  return 'text-muted-light'
}

export function Console({ lines }: ConsoleProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // 新しい行が来たら最後まで送る
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  return (
    <div
      className="h-full overflow-auto bg-surface-inset px-3 py-2 font-mono text-xs leading-[1.65]"
      role="log"
      aria-live="polite"
    >
      {lines.length === 0 ? (
        <span className="text-muted-light">{messages.console.placeholder}</span>
      ) : (
        lines.map((line, i) => (
          <div key={`${i}-${line.slice(0, 24)}`} className={`whitespace-pre-wrap ${lineTone(line)}`}>
            {line}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  )
}
