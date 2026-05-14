import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',       // 自動更新 SW，不需要使用者手動重整
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: '還帳 Hái帳',
        short_name: '還帳',
        description: '公司墊付款項追蹤工具',
        theme_color: '#18181b',
        background_color: '#fafafa',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        lang: 'zh-TW',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // 預先 cache 所有建置產物
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // runtime cache：API 請求（如果你接了 Supabase）
        runtimeCaching: [
          {
            // Supabase REST API — network first，有網就抓新的
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 1 天
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      // Dev 模式也啟用 SW，方便測試
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
