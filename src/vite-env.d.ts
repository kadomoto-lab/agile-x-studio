/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 初期表示ロケール（保存済みの選択がない場合）。未設定時は ja（vite.config.ts で固定）。 */
  readonly VITE_LOCALE?: 'ja' | 'en'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
