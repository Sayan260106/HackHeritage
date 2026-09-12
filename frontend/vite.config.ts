import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: true,
      // The console used to be served by Vite running inside Express, which is
      // why every component fetches a same-origin '/api/...' path. Express is
      // gone, so Vite serves the console itself and forwards those same paths
      // to orca-core. Nothing in src/ changed: the browser still sees one
      // origin, and there is no CORS in the picture.
      //
      // ORCA_API_URL overrides the target for a deployed backend.
      proxy: {
        '/api': {
          target: process.env.ORCA_API_URL || 'http://127.0.0.1:8100',
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/venv/**', '**/venv-ml/**', '**/.venv/**', '**/data/realtime/**'],
      },
    },
  };
});
