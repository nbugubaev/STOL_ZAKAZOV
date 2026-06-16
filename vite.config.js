import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // Доска модератора: открывается на главной "/"
        main: resolve(__dirname, 'index.html'),
        // Форма Mini App: открывается на "/form.html"
        form: resolve(__dirname, 'form.html'),
      },
    },
  },
})
