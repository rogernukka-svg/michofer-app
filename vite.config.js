import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      proxy: supabaseUrl
        ? {
            '/supabase-proxy': {
              target: supabaseUrl,
              changeOrigin: true,
              secure: true,
              rewrite: (path) => path.replace(/^\/supabase-proxy/, ''),
            },
          }
        : undefined,
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: ['michofer-app.onrender.com'],
    },
  }
})
