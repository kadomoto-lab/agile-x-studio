import { Languages } from 'lucide-react'
import { LOCALES, messages, setLocale, useLocale, type Locale } from '../i18n'

const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
}

/** ヘッダ右上の表示言語トグル（ja / en）。 */
export function LanguageToggle() {
  const locale = useLocale()

  return (
    <div
      role="group"
      aria-label={messages.app.languageToggle}
      title={messages.app.languageToggle}
      className="flex items-center gap-1 rounded-lg border border-ax-navy-muted p-0.5"
    >
      <Languages className="ml-1 h-3.5 w-3.5 text-on-navy/70" aria-hidden />
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => setLocale(l)}
          className={
            l === locale
              ? 'rounded-md bg-ax-blue px-2 py-0.5 text-xs font-semibold text-on-navy'
              : 'rounded-md px-2 py-0.5 text-xs text-on-navy/70 transition-colors hover:bg-ax-navy-muted hover:text-on-navy'
          }
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  )
}
