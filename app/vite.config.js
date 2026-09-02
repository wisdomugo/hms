import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * base: '/app/' means the staff app is served under /app in production, which
 * leaves the root free for the patient portal later.
 *
 * Vite honours base in DEVELOPMENT too, so the dev URL is
 *   http://localhost:5173/app/
 * not http://localhost:5173/ . Correct in both environments, but it does
 * surprise people once.
 *
 * The proxy is what makes /api and /uploads reach the API on port 3000 during
 * development. If it is missing or wrong, the dev server does not 404 — it
 * serves index.html with a 200, because that is what an SPA fallback does, and
 * any code calling .json() on that throws something baffling. Step 1's health
 * screen checks the content type specifically so that failure names itself.
 */
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    port: 5173,

    // Subdomains of .localhost resolve to 127.0.0.1 in every current browser
    // with no hosts-file edit, which is what makes per-hospital hostnames
    // testable locally: clinic.localhost:5173, stnicholas.localhost:5173.
    allowedHosts: ['localhost', '.localhost'],

    proxy: {
      // changeOrigin is FALSE on purpose.
      //
      // True rewrites the Host header to the proxy target, so the API sees
      // "localhost:3000" for every request no matter what is in the address
      // bar. That makes the production resolution path — hostname to hospital
      // — impossible to exercise in development, and quietly sends every
      // request to whichever hospital happens to own "localhost".
      //
      // False forwards the original Host, so clinic.localhost:5173 reaches the
      // API as clinic.localhost and resolves the way it will in production.
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: false }
    }
  }
});
