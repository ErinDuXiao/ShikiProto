/// <reference types="vite/client" />
import { defineConfig, loadEnv } from 'vite';

/**
 * GitHub Pages serves this repo from /ShikiProto/, so the production build has
 * to emit asset URLs under that prefix. Dev stays at / -- setting the base
 * unconditionally would move the local server to
 * http://localhost:5199/ShikiProto/ for no reason.
 */
const REPO_BASE = '/ShikiProto/';

export default defineConfig(({ command, mode }) => {
  // port comes from the environment so this dev server can share a machine
  // with other projects; unset falls back to Vite's own default
  const env = loadEnv(mode, '.', 'PORT');
  const port = env.PORT ? Number(env.PORT) : undefined;
  return {
    base: command === 'build' ? REPO_BASE : '/',
    server: { port, strictPort: false },
    build: { target: 'es2020' },
  };
});
