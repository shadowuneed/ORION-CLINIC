import { isAbsolute, relative, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Watching and Git ignore rules do not protect files from Vite's HTTP server.
// API downloads remain governed by their resource-specific authorization.
const privateDirectories = new Set([
  '.git', '.wrangler', '.orion-runtime', '.vinext', '.ssh', '.aws',
  'local-auth', 'artifacts', 'backups', 'exports', 'recordings', 'tmp',
  'work', 'outputs', 'dist',
]);
const privateName = /^(?:\.env(?:\..*)?|\.?dev\.vars(?:\..*)?|accounts(?:-[a-z0-9-]+)?\.(?:html|sqlite)(?:[.~-].*)?|auth\.json(?:[.~].*)?|credentials(?:\.json)?(?:[.~].*)?|service-account\.json(?:[.~].*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.netrc|id_rsa|id_ed25519)$/i;
const privateExtension = /\.(?:db|sqlite|sqlite3)(?:[.~-].*)?$|\.(?:pem|key|p12|pfx|crt|log)(?:[.~].*)?$/i;

/** Defense in depth for Vite FS resolution, including aliases and ?raw imports. */
export const privateFileDenyPatterns = [
  '**/.env', '**/.env.*', '**/.dev.vars*', '**/dev.vars*',
  '**/*.{db,sqlite,sqlite3}', '**/*.{db,sqlite,sqlite3}-*', '**/*.{db,sqlite,sqlite3}.*',
  '**/*.{crt,pem,key,p12,pfx,log}', '**/accounts.html*', '**/accounts-*.html*', '**/auth.json*',
  '**/credentials*', '**/service-account.json*', '**/.npmrc', '**/.netrc',
  ...['.git', '.wrangler', '.vinext', '.ssh', '.aws', 'local-auth', 'backups', 'recordings'].map(name => `**/${name}/**`),
  '**/.orion-runtime/vite-cache/**/_metadata.json',
];

export type PrivateHttpPathsOptions = { root: string; clientCacheDir: string };
const slash = (value: string) => value.replaceAll('\\', '/');

function clientCacheAsset(pathname: string, options?: PrivateHttpPathsOptions): boolean {
  if (!options) return false;
  const root = resolve(options.root);
  const cache = resolve(options.clientCacheDir);
  const cacheRelative = relative(root, cache);
  // Never permit an arbitrary directory outside this checkout as a cache escape.
  if (!cacheRelative || isAbsolute(cacheRelative) || cacheRelative.startsWith('..') ||
    !slash(cacheRelative).startsWith('.orion-runtime/vite-cache/')) return false;
  const target = pathname.startsWith('/@fs/') ? pathname.slice(5) : resolve(root, `.${pathname}`);
  const fromCache = slash(relative(cache, target));
  // Only client optimizer output is public. Metadata, server transforms, logs,
  // subdirectories, traversal and other runtime state are never whitelisted.
  return /^deps\/[A-Za-z0-9_@.-]+\.js(?:\.map)?$/.test(fromCache);
}

/** Pure path check; never opens account stores, private files, or credentials. */
export function isPrivateHttpRequest(target: string, options?: PrivateHttpPathsOptions): boolean {
  if (!target.startsWith('/') || target.startsWith('//') || target.length > 16_384) return true;
  let pathname = target.split(/[?#]/, 1)[0];
  // Inspect every decoding layer before URL normalization can hide a directory.
  for (let depth = 0; depth < 8; depth += 1) {
    pathname = slash(pathname);
    if (/[\u0000-\u001f\u007f]/.test(pathname)) return true;
    const segments = pathname.toLowerCase().split('/').map(part => part.replace(/[ .]+$/g, ''));
    if (segments.some(part => privateName.test(part) || privateExtension.test(part))) return true;
    const apiRoute = /^\/api\/[a-zA-Z0-9/_-]+$/.test(pathname) && !segments.includes('..');
    // Package "dist" directories are application code, unlike root dist (a
    // generated server build). Do not break Vite's ordinary dependency imports.
    const packageAsset = segments.includes('node_modules') && !segments.includes('..');
    if (!apiRoute && segments.some(part => privateDirectories.has(part) && !(part === 'dist' && packageAsset)) && !clientCacheAsset(pathname, options)) return true;
    if (!pathname.includes('%')) return false;
    try { pathname = decodeURIComponent(pathname); }
    catch { return true; }
  }
  return true;
}

/** Install before static/public middleware; the latter bypasses Vite fs.deny. */
export function privateHttpFiles(options?: PrivateHttpPathsOptions) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!isPrivateHttpRequest(request.url ?? '/', options)) { next(); return; }
    response.statusCode = 404;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end();
  };
}
