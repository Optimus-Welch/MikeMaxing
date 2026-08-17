import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Stamp the build so "is the deployed site actually running my code?" is a
// question you can answer by looking at the screen, instead of guessing from
// deploy timestamps. CI provides GITHUB_SHA; locally we ask git.
function buildSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Served from https://<user>.github.io/MikeMaxing/ — every asset URL
  // needs this prefix in production, but dev (`vite`) stays at "/".
  base: command === 'build' ? '/MikeMaxing/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'MikeMaxing',
        short_name: 'MikeMaxing',
        description: 'Personal workout planner — readiness-based session recommendations.',
        start_url: '.',
        display: 'standalone',
        background_color: '#101115',
        theme_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
}));
