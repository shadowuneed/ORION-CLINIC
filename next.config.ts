import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  webpack(config, { webpack }) {
    // Compile the existing UI without loading a Workers runtime. The adapter
    // deliberately throws on every binding access until the cloud port exists.
    const workersCompat = fileURLToPath(
      new URL('./cloud/runtime/workers-compat.ts', import.meta.url),
    );
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      'cloudflare:workers': workersCompat,
    };
    config.plugins ??= [];
    config.plugins.push(
      // Scheme imports bypass ordinary aliases in webpack's URI handling.
      new webpack.NormalModuleReplacementPlugin(/^cloudflare:workers$/, workersCompat),
      new webpack.DefinePlugin({ __ORION_LOCAL_CREDENTIALS__: 'false' }),
    );
    config.module ??= { rules: [] };
    config.module.rules ??= [];
    config.module.rules.push({
      test: /\.ttf$/i,
      resourceQuery: /^\?inline$/,
      // Next supplies an asset filename generator; use the hybrid asset type
      // with unconditional inlining to preserve the existing data-URI contract.
      type: 'asset',
      parser: { dataUrlCondition: () => true },
    });
    return config;
  },
};

export default nextConfig;
