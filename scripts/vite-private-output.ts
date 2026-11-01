import { basename } from 'node:path';
import type { Plugin } from 'vite';

/** Cloudflare emits local preview credentials as an asset during a build.
 * They must never reach dist, even when the source file is correctly ignored.
 * Remove only generated environment assets, before writeBundle; source files
 * and local development bindings are untouched. The artifact scan remains a
 * separate fail-closed upload gate for every other file and bundled secrets.
 */
export function excludePrivateEnvironmentAssets(): Plugin {
  return {
    name: 'orion-no-private-environment-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const [name, item] of Object.entries(bundle)) {
          const leaf = basename(name.replaceAll('\\', '/')).toLowerCase();
          if (!/^\.(?:dev\.vars|env)(?:\..*)?$/.test(leaf)) continue;
          if (item.type !== 'asset') throw new Error('Private environment output must not be emitted as executable code');
          delete bundle[name];
        }
      },
    },
  };
}
