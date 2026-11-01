import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, loadEnv } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(async ({ command, mode }) => {
  // Load ignored local secrets only for the development server. Production
  // builds receive runtime secrets from the hosting environment instead.
  const fileEnv = command === 'serve' ? loadEnv(mode, process.cwd(), '') : {};
  const localRuntimeVars = {
    ...(process.env.GROQ_LLM_API_KEY ?? fileEnv.GROQ_LLM_API_KEY
      ? {
          GROQ_LLM_API_KEY:
            process.env.GROQ_LLM_API_KEY ?? fileEnv.GROQ_LLM_API_KEY,
        }
      : {}),
    ...(process.env.GROQ_LLM_MODEL ?? fileEnv.GROQ_LLM_MODEL
      ? {
          GROQ_LLM_MODEL:
            process.env.GROQ_LLM_MODEL ?? fileEnv.GROQ_LLM_MODEL,
        }
      : {}),
    ...(process.env.GROQ_COMPOUND_API_KEY ?? fileEnv.GROQ_COMPOUND_API_KEY
      ? {
          GROQ_COMPOUND_API_KEY:
            process.env.GROQ_COMPOUND_API_KEY ?? fileEnv.GROQ_COMPOUND_API_KEY,
        }
      : {}),
    ...(process.env.GROQ_COMPOUND_MODEL ?? fileEnv.GROQ_COMPOUND_MODEL
      ? {
          GROQ_COMPOUND_MODEL:
            process.env.GROQ_COMPOUND_MODEL ?? fileEnv.GROQ_COMPOUND_MODEL,
        }
      : {}),
  };
  const localBindingConfig = {
    main: 'vinext/server/app-router-entry',
    compatibility_flags: ['nodejs_compat'],
    vars: localRuntimeVars,
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: 'site-creator-d1',
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: 'site-creator-r2',
          },
        ]
      : [],
  };

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      allowedHosts: ['.ngrok-free.dev'],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
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
