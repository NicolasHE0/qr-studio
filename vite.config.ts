import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Reemplaza %CONNECT_SRC% en la CSP con los orígenes realmente configurados (Supabase y dominio de redirección). */
function cspConnect(env: Record<string, string>) {
  const origins = new Set<string>()
  for (const v of [env.VITE_SUPABASE_URL, env.VITE_REDIRECT_BASE]) {
    try { if (v) origins.add(new URL(v).origin) } catch { /* valor inválido: se ignora */ }
  }
  return { name: 'qr-studio-csp', transformIndexHtml: (html: string) => html.replace('%CONNECT_SRC%', [...origins].join(' ')).replace(/connect-src 'self'\s*;/, "connect-src 'self';") }
}

export default defineConfig(({ mode }) => ({
  // En GitHub Pages el sitio vive en /nombre-del-repo/: el workflow define VITE_BASE. En local y dominio propio queda '/'.
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    cspConnect(loadEnv(mode, process.cwd(), 'VITE_')),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'QR Studio',
        short_name: 'QR Studio',
        description: 'Generador de códigos QR estáticos y dinámicos. Privado y sin servidor para los QR estáticos.',
        lang: 'es-AR',
        theme_color: '#4f46e5',
        background_color: '#f7f7fb',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Solo se cachean los recursos propios de la app. Las llamadas a Supabase nunca se cachean.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallbackDenylist: [/^\/r\//],
      },
    }),
  ],
  test: { environment: 'jsdom', globals: true },
}))
