import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

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

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; secrets belong in ignored `.env*` files, never in this config.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      watch: isCodexSeatbeltSandbox
        ? {
            ignored: ignoredRuntimePaths,
            useFsEvents: false,
            usePolling: true,
          }
        : { ignored: ignoredRuntimePaths },
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
