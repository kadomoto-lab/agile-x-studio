/**
 * UI ロケール。ヘッダ右上のトグルで実行時に切替できる。
 *
 * 初期値: localStorage の保存値 → VITE_LOCALE（ビルド時既定、未設定時 ja）。
 * `messages` / `locale` は ES モジュールのライブバインディングなので、
 * 描画時に `messages.…` を読めば切替後の文言になる。再描画は App が
 * useLocale() で購読して起こす（子は props 経由で再描画される）。
 */
import { useSyncExternalStore } from 'react'
import type { Locale, Messages } from './types'
import ja from './ja'
import en from './en'

const STORAGE_KEY = 'agilex-studio.locale'

const catalogs: Record<Locale, Messages> = { ja, en }

export const LOCALES: readonly Locale[] = ['ja', 'en']

function isLocale(value: unknown): value is Locale {
  return value === 'ja' || value === 'en'
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // プライベートモード等で localStorage が使えない場合はビルド既定値
  }
  return import.meta.env.VITE_LOCALE === 'en' ? 'en' : 'ja'
}

export let locale: Locale = initialLocale()

export let messages: Messages = catalogs[locale]

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setLocale(next: Locale): void {
  if (next === locale) return
  locale = next
  messages = catalogs[next]
  document.documentElement.lang = messages.htmlLang
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 保存できなくても切替自体は有効
  }
  listeners.forEach((l) => l())
}

/** 現在のロケールを購読する。切替時にコンポーネントを再描画させる。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => locale)
}

export type { Locale, Messages }
