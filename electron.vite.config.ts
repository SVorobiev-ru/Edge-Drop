import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { slimEmojiPlugin, woff2OnlyPlugin } from './scripts/viteAssetPlugins'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    // Root must be project root because index.html lives there.
    root: '.',
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    build: {
      minify: true,
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') }
      }
    },
    plugins: [react(), slimEmojiPlugin(), woff2OnlyPlugin()]
  }
})
