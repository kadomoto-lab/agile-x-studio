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
      className="flex h-8 items-center gap-0.5 rounded-md border border-on-navy/15 p-0.5"
    >
      <Languages className="mx-1 h-3.5 w-3.5 text-on-navy/60" aria-hidden />
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => setLocale(l)}
          // 選択中は控えめに示す（青い塗りは「シミュレーション実行」だけに使う）
          className={
            l === locale
              ? 'h-full rounded-[5px] bg-on-navy/15 px-2 text-xs font-semibold text-on-navy'
              : 'h-full rounded-[5px] px-2 text-xs text-on-navy/65 transition-colors hover:bg-on-navy/10 hover:text-on-navy'
          }
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  )
}
