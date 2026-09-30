// Explicit test-only config: never imported by vite.config.ts or production builds.
import { defineConfig, type ViteDevServer } from 'vite';
import vinext from 'vinext';
import tailwindcss from '@tailwindcss/postcss';
import { resolve, relative, isAbsolute } from 'node:path';
import { personaAuth } from './scripts/persona-auth';

export default defineConfig(async ({ command, mode }) => {
  if (command !== 'serve' || mode !== 'test' || process.env.ORION_PERSONA_TEST !== '1') {
    throw new Error('Persona config is only for explicit local test serving');
  }
  const runRoot = resolve(process.env.ORION_PERSONA_ROOT ?? '');
  const rel = relative(resolve('work/personas'), runRoot);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Isolated persona run directory required');
  const port = Number(process.env.ORION_PERSONA_PORT ?? '');
  if (!Number.isInteger(port) || port < 3213 || port > 3299) throw new Error('Isolated port 3213-3299 required');
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  const cacheScope = ['serve', mode, process.env.NODE_ENV ?? 'development']
    .map(encodeURIComponent).join('-');
  return {
    envDir: runRoot, cacheDir: resolve(runRoot, 'vite-cache', cacheScope),
    css: { postcss: { plugins: [tailwindcss()] } },
    server: { host: '127.0.0.1', port, strictPort: true, watch: { ignored: ['**/work/**', '**/.wrangler/**', '**/.orion-runtime/**', '**/dist/**', '**/.vinext/**', '**/outputs/**'] } },
    plugins: [
      { name: `orion-persona-cache-v1-${cacheScope}` },
      { name: 'orion-isolated-personas', configureServer(server: ViteDevServer) { server.middlewares.use(personaAuth(port)); } },
      vinext(),
      cloudflare({ configPath: resolve(runRoot, 'wrangler.json'), persistState: { path: resolve(runRoot, 'state') },
        inspectorPort: false, remoteBindings: false,
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } }),
    ],
  };
});
