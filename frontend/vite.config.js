import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Binds to 0.0.0.0 instead of just localhost, so devices on the same
    // Wi-Fi network (e.g. your phone) can reach the dev server using your
    // machine's LAN IP. See the README's "Access NoteWise from your phone".
    host: true,
  },
})
