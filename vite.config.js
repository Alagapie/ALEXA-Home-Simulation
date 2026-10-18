import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite configuration for the Smart Room Simulator.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
  },
})
