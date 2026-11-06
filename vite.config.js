import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// 地球Online Web 重构版 — Vite + Vue 3 + Pinia + PWA
// 设计目标：standalone 沉浸式、主题色对齐 Android、启动屏防白屏、可安装。
export default defineConfig({
  base: './',
  // 3.0：构建时间戳，用于「关于」页与线上版本核对
  define: {
    __EO_BUILDTIME__: JSON.stringify(new Date().toISOString())
  },
  plugins: [
    vue(),
    VitePWA({
      // 3.0：改为 prompt 模式 —— 新版本等用户点击「立即刷新」再切换，避免编辑中被强制重载
      registerType: 'prompt',
      includeAssets: [
        'icons/icon.svg',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/icon.png',
        'icons/sponsor-qr.webp'
      ],
      manifest: {
        name: '地球Online',
        short_name: '地球Online',
        description: '记录你的人生副本 — 任务 / 背包 / 笔记 / 相册 / 地图 / AI 中枢',
        lang: 'zh-CN',
        theme_color: '#FAF8F3',
        background_color: '#FAF8F3',
        display: 'standalone',
        display_override: ['standalone', 'window-controls-overlay'],
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json,wasm}'],
        cleanupOutdatedCaches: true,
        // prompt 模式：不自动抢占客户端，等用户确认后由 updateSW(true) 接管
        clientsClaim: false,
        skipWaiting: false,
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
    // 每次构建先清空 dist：否则旧 chunk 会累积并被 PWA 预缓存（曾涨到 1500+ 文件）
    emptyOutDir: true,
    target: 'es2018',
    chunkSizeWarningLimit: 1200
  },
  // v2.0.0 P1：内置 Steam Web API 代理（Steam 官方不返回 CORS 头，浏览器直连必被拦截）
  // dev / preview 走这里，线上同语义代理由零依赖生产服务 server.js 提供。
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: { '/steam-api': { target: 'https://api.steampowered.com', changeOrigin: true, secure: true, rewrite: (p) => p.replace(/^\/steam-api/, '') } }
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: { '/steam-api': { target: 'https://api.steampowered.com', changeOrigin: true, secure: true, rewrite: (p) => p.replace(/^\/steam-api/, '') } }
  }
})
