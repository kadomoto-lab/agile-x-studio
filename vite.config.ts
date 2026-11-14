import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const locale = process.env.VITE_LOCALE === 'en' ? 'en' : 'ja'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // 初期表示ロケール import.meta.env.VITE_LOCALE をビルド時に固定（未設定時は ja）
    'import.meta.env.VITE_LOCALE': JSON.stringify(locale),
  },
  build: {
    outDir: locale === 'en' ? 'dist-en' : 'dist',
    chunkSizeWarningLimit: 2500,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
