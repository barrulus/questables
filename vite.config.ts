import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const defaultTlsCertPath = env.DEV_SERVER_TLS_CERT || path.resolve(__dirname, 'quixote.tail3f19fe.ts.net.crt')
  const defaultTlsKeyPath = env.DEV_SERVER_TLS_KEY || path.resolve(__dirname, 'quixote.tail3f19fe.ts.net.key')

  const tlsPreference = env.DEV_SERVER_USE_TLS
  const hasDefaultTlsFiles = existsSync(defaultTlsCertPath) && existsSync(defaultTlsKeyPath)
  const shouldUseTls = tlsPreference === 'true' || (tlsPreference === undefined && hasDefaultTlsFiles && mode !== 'test')

  let httpsOptions: { cert: Buffer; key: Buffer } | undefined

  if (shouldUseTls) {
    const certPath = tlsPreference === 'true' && env.DEV_SERVER_TLS_CERT ? env.DEV_SERVER_TLS_CERT : defaultTlsCertPath
    const keyPath = tlsPreference === 'true' && env.DEV_SERVER_TLS_KEY ? env.DEV_SERVER_TLS_KEY : defaultTlsKeyPath

    if (!existsSync(certPath) || !existsSync(keyPath)) {
      console.warn('[Vite] TLS requested but certificate files are missing, falling back to HTTP', {
        certPath,
        keyPath,
      })
    } else {
      try {
        httpsOptions = {
          cert: readFileSync(certPath),
          key: readFileSync(keyPath),
        }
        console.log('[Vite] HTTPS enabled for dev server', { certPath, keyPath })
      } catch (error) {
        console.warn('[Vite] Failed to load TLS certificates, falling back to HTTP', error)
        httpsOptions = undefined
      }
    }
  }

  const publicHmrHost = env.DEV_SERVER_PUBLIC_HOST;
  const publicHmrPort = env.DEV_SERVER_PUBLIC_PORT ? parseInt(env.DEV_SERVER_PUBLIC_PORT, 10) : undefined;
  const publicHmrClientPort = env.DEV_SERVER_PUBLIC_CLIENT_PORT ? parseInt(env.DEV_SERVER_PUBLIC_CLIENT_PORT, 10) : undefined;

  const hmrConfig = publicHmrHost
    ? {
        host: publicHmrHost,
        port: publicHmrPort ?? 3000,
        clientPort: publicHmrClientPort ?? publicHmrPort ?? 3000,
        protocol: httpsOptions ? 'wss' : 'ws',
      }
    : (httpsOptions ? { protocol: 'wss' as const } : undefined);

  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      // Limit dependency pre-bundling scan to the main app entry
      entries: ['index.html'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: process.env.NODE_ENV === 'development',

      // Code splitting optimization
      rollupOptions: {
        output: {
          manualChunks: {
            // Separate vendor chunks for better caching
            vendor: ['react', 'react-dom'],
            ui: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-tabs'],
            utils: ['date-fns', 'clsx', 'tailwind-merge']
          },
          // Optimize chunk file names
          chunkFileNames: (chunkInfo) => {
            const facadeModuleId = chunkInfo.facadeModuleId ?
              chunkInfo.facadeModuleId.split('/').pop()?.replace('.tsx', '').replace('.ts', '') :
              'chunk';
            return `assets/${facadeModuleId}-[hash].js`;
          }
        }
      },

      // Compression and minification
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: process.env.NODE_ENV === 'production',
          drop_debugger: process.env.NODE_ENV === 'production'
        }
      },

      // Bundle size limits
      chunkSizeWarningLimit: 1000,

      // Asset optimization
      assetsInlineLimit: 4096, // 4kb

      // Disable CSS code splitting for better performance
      cssCodeSplit: false
    },
    server: {
      port: 3000,
      host: true,
      https: httpsOptions,
      hmr: hmrConfig,
      watch: {
        ignored: ['**/map_data/**','**/public/**'],
      },
    },
    define: {
      // This helps ensure environment variables are accessible
      'process.env': {}
    }
  }
})
