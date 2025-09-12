import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Allow imports like "pkg@1.2.3" by stripping the version suffix
      { find: /^(.*)@\d+\.\d+\.\d+$/, replacement: '$1' },
      { find: '@', replacement: path.resolve(__dirname, './') },
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    host: true
  },
  define: {
    // This helps ensure environment variables are accessible
    'process.env': {}
  }
})
