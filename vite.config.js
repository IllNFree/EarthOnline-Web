import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// 地球Online Web 重构版 — Vite + Vue 3 + Pinia + PWA
// 设计目标：standalone 沉浸式、主题色对齐 Android、启动屏防白屏、可安装。
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon.svg',
        'icons/icon-512.png',
        'icons/icon.png',
        'icons/sponsor-qr.webp'
      ],
      manifest: {
        name: '地球Online',
        short_name: '地球Online',
        description: '记录你的人生副本 — 任务 / 背包 / 笔记 / 相册 / 地图 / AI 中枢',
        lang: 'zh-CN',
        theme_color: '#D4A373',
        background_color: '#F8F6F2',
        display: 'standalone',
        display_override: ['standalone', 'window-controls-overlay'],
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json,wasm}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/icons/'),
            handler: 'CacheFirst',
            options: { cacheName: 'eo-icons', expiration: { maxEntries: 30 } }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2018',
    chunkSizeWarningLimit: 1200
  }
})
