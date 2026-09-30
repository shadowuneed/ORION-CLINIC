import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };
import { localAccountAuth } from './scripts/local-account-auth';
import { findLocalStaffDatabase, localAccountPaths, openLocalAccountStore } from './scripts/local-account-store';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

// Runtime state is intentionally kept inside the checkout so that the local
// launcher remains portable. None of it is application source, and some files
// (browser cookies, SQLite journals, model logs) can be exclusively locked on
// Windows. Watching those paths can terminate Vite with EBUSY while ORION is
// otherwise healthy.
const ignoredRuntimePaths = [
  '**/.orion-runtime/**',
  '**/.wrangler/**',
  '**/artifacts/**',
  '**/backups/**',
  '**/exports/**',
  '**/recordings/**',
  '**/tmp/**',
  '**/dist/**',
  '**/.vinext/**',
  '**/work/**',
  '**/outputs/**',
];

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  vars: {
    ORION_ENV: 'development',
    ORION_BUILD_ID: 'local',
    ORION_SYNTHETIC_DATA_ONLY: 'true',
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'orion-clinic-local',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'orion-clinic-local',
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode, isPreview }) => {
  const root = fileURLToPath(new URL('./', import.meta.url));
  // Normal local development uses personal credentials even when the registry
  // is empty/missing. Losing a credential file can never revive auto-login.
  const localCredentials = command === 'serve' && !isPreview && mode === 'development';
  const accountPaths = localCredentials ? localAccountPaths(root) : null;
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; secrets belong in ignored `.env*` files, never in this config.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  // The default node_modules/.vite cache is also used by Vitest and other Vite
  // invocations. Re-optimization there can remove chunks still referenced by an
  // open dev browser. Keep each runtime/build mode in its own ignored cache.
  // Encode custom mode names so a CLI mode cannot escape this cache root.
  const cacheScope = [
    isPreview ? 'preview' : command,
    mode,
    process.env.NODE_ENV ?? (command === 'build' ? 'production' : 'development'),
  ].map(encodeURIComponent).join('-');

  return {
    define: { __ORION_LOCAL_CREDENTIALS__: JSON.stringify(localCredentials) },
    cacheDir: resolve(fileURLToPath(new URL('./.orion-runtime/vite-cache/', import.meta.url)), cacheScope),
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      ...(localCredentials ? { host: '127.0.0.1', strictPort: true } : {}),
      watch: isCodexSeatbeltSandbox
        ? {
            ignored: ignoredRuntimePaths,
            useFsEvents: false,
            usePolling: true,
          }
        : { ignored: ignoredRuntimePaths },
    },
    plugins: [
      // Vite hashes plugin names but not cacheDir. Include the namespace so
      // previously immutable ?v= imports cannot retain a different React copy
      // after a cache relocation or a runtime-mode change.
      { name: `orion-cache-v1-${cacheScope}-${localCredentials ? 'staff' : 'provider'}` },
      ...(localCredentials && accountPaths ? [{ name: 'orion-local-staff-credentials', enforce: 'pre' as const,
        configureServer(server: ViteDevServer) {
          const store = openLocalAccountStore(accountPaths.database, findLocalStaffDatabase(root));
          const port = server.config.server.port ?? 3200;
          server.middlewares.use(localAccountAuth(port, async () => store.loadAccounts(), Date.now, store));
          server.httpServer?.once('close', () => store.close());
        },
      }] : []),
      vinext(),
      ...(localCredentials ? [] : [sites()]),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
