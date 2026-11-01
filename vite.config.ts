import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };
import { localAccountAuth, type VerifiedLocalPrincipal } from './scripts/local-account-auth';
import { findLocalStaffDatabase, localAccountPaths, openLocalAccountStore, readLocalAccountAuthority } from './scripts/local-account-store';
import { crmLocalMiddleware } from './scripts/crm-local-middleware';
import { readCrmLocalConfig } from './scripts/crm-local-config';
import { createCrmPostgresRepository } from './scripts/crm-postgres-repository';
import { parseCrmCommand } from './lib/crm/contracts';
import { privateFileDenyPatterns, privateHttpFiles } from './scripts/private-http-paths';
import { excludePrivateEnvironmentAssets } from './scripts/vite-private-output';
import { clinicalLocalMiddleware } from './scripts/clinical-local-middleware';
import { createClinicalPostgresRepository } from './scripts/clinical-postgres-repository';
import { clinicalCommandSchema } from './lib/clinical/contracts';
import { createClinicalSpeechBridge } from './scripts/clinical-speech-bridge';
import { LocalGigaamProvider } from './lib/providers/local-gigaam';
import { readClinicalProviderConfig } from './scripts/clinical-provider-config';
import { GroqClinicalAnalysisProvider } from './lib/providers/groq-clinical-analysis';
import { assertDirectoryAuthority, createPostgresStaffDirectory } from './scripts/postgres-staff-directory';
import { createDirectoryPostgresRepository } from './scripts/directory-postgres-repository';
import { directoryLocalMiddleware } from './scripts/directory-local-middleware';
import { postgresAuthorityRouteGuard } from './scripts/postgres-authority-route-guard';
import { createRegionalPostgresRepository } from './scripts/regional-postgres-repository';
import { regionalLocalMiddleware } from './scripts/regional-local-middleware';
import { regionalBriefingMiddleware } from './scripts/regional-ai-briefing';

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
  const cacheDir = resolve(fileURLToPath(new URL('./.orion-runtime/vite-cache/', import.meta.url)), cacheScope);

  return {
    define: { __ORION_LOCAL_CREDENTIALS__: JSON.stringify(localCredentials) },
    cacheDir,
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      ...(localCredentials ? { host: '127.0.0.1', strictPort: true } : {}),
      fs: { deny: privateFileDenyPatterns },
      // Pre-transform only the frequently opened local CRM/client shell. This
      // warms code, never patient snapshots or authentication/authority results.
      ...(localCredentials ? { warmup: { clientFiles: [
        './app/clinic-shell.tsx', './app/crm/crm-workspace.tsx',
        './app/crm/crm-scene.tsx', './app/crm/crm-operations.tsx',
      ] } } : {}),
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
      { name: 'orion-private-http-files', enforce: 'pre' as const, configureServer(server: ViteDevServer) {
        server.middlewares.use(privateHttpFiles({ root, clientCacheDir: cacheDir }));
      } },
      ...(localCredentials && accountPaths ? [{ name: 'orion-local-staff-credentials', enforce: 'pre' as const,
        async configureServer(server: ViteDevServer) {
          const authority = readLocalAccountAuthority(accountPaths.database);
          const config = readCrmLocalConfig();
          if (authority === 'postgresql' && !config) throw new Error('PostgreSQL staff directory is required after cutover.');
          const directoryProbe = config ? createPostgresStaffDirectory(config) : null;
          // Read the canonical mode on every startup, including hot restarts,
          // even when the private marker says legacy.
          // A missing/stale marker must never revive D1 after PG activation.
          // The directory source and the private downgrade fence must agree.
          if (directoryProbe) {
            try { assertDirectoryAuthority(await directoryProbe.mode(), authority); }
            catch (error) { await directoryProbe.close(); throw error; }
          }
          const staffDirectory = authority === 'postgresql' ? directoryProbe : null;
          if (directoryProbe && !staffDirectory) await directoryProbe.close();
          const store = openLocalAccountStore(accountPaths.database, staffDirectory ?? findLocalStaffDatabase(root));
          const port = server.config.server.port ?? 3200;
          const principals = new WeakMap<IncomingMessage, VerifiedLocalPrincipal>();
          // Read PC-only connection config only in explicit local development.
          let repository: ReturnType<typeof createCrmPostgresRepository> | null = null;
          let clinicalRepository: ReturnType<typeof createClinicalPostgresRepository> | null = null;
          let speech: ReturnType<typeof createClinicalSpeechBridge> | null = null;
          let directoryRepository: ReturnType<typeof createDirectoryPostgresRepository> | null = null;
          let regionalRepository: ReturnType<typeof createRegionalPostgresRepository> | null = null;
          let regionalProvider: ReturnType<typeof readClinicalProviderConfig>['groq'] | null = null;
          try {
            if (config) {
              repository = createCrmPostgresRepository(config);
              clinicalRepository = createClinicalPostgresRepository(config);
              directoryRepository = createDirectoryPostgresRepository(config);
              regionalRepository = createRegionalPostgresRepository(config);
              const providers = readClinicalProviderConfig(root);
              regionalProvider = providers.groq;
              speech = createClinicalSpeechBridge({ repository: clinicalRepository,
                provider: new LocalGigaamProvider(providers.localSpeech),
                analysisProvider: providers.groq.apiKey ? new GroqClinicalAnalysisProvider({ ...providers.groq, apiKey: providers.groq.apiKey }) : undefined });
            }
          } catch { /* New APIs fail closed; never substitute the legacy clinical database. */ }
          server.middlewares.use(localAccountAuth(port, () => store.loadActiveAccounts(), Date.now, store,
            (request, principal) => principals.set(request, principal), { root, clientCacheDir: cacheDir }));
          server.middlewares.use(postgresAuthorityRouteGuard(() => readLocalAccountAuthority(accountPaths.database)));
          server.middlewares.use(regionalBriefingMiddleware({ port, principal: request => principals.get(request), repository: regionalRepository, provider: regionalProvider }));
          server.middlewares.use(regionalLocalMiddleware({ port, principal: request => principals.get(request), repository: regionalRepository }));
          server.middlewares.use(directoryLocalMiddleware({ port, principal: request => principals.get(request), repository: directoryRepository }));
          server.middlewares.use(clinicalLocalMiddleware({ port, principal: request => principals.get(request), repository: clinicalRepository,
            parseCommand: value => clinicalCommandSchema.parse(value), speech }));
          server.middlewares.use(crmLocalMiddleware({ port, principal: request => principals.get(request), repository, parseCommand: parseCrmCommand }));
          server.httpServer?.once('close', () => { store.close(); void repository?.close(); void clinicalRepository?.close(); void speech?.close(); void directoryRepository?.close(); void regionalRepository?.close(); void staffDirectory?.close(); });
        },
      }] : []),
      vinext(),
      ...(localCredentials ? [] : [sites()]),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
      excludePrivateEnvironmentAssets(),
    ],
  };
});
