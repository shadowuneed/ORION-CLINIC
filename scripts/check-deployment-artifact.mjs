import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, join, extname, basename, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const privateDirectories = new Set(['.git', '.wrangler', '.orion-runtime', '.ssh', '.aws', 'recordings', 'backups', 'exports']);
const privateExtensions = new Set(['.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx', '.dcm', '.wav', '.webm', '.mp3', '.m4a', '.flac', '.ogg', '.pdf', '.docx', '.zip', '.gz', '.br', '.tar', '.tgz', '.7z', '.rar', '.bz2', '.xz']);
const privateNames = new Set(['auth.json', '.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', 'credentials', 'credentials.json', 'service-account.json', 'id_rsa', 'id_ed25519']);
const credentialPatterns = [
  ['groq-key', /\bgsk_[A-Za-z0-9]{20,}\b/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['aws-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

function hasPrefix(bytes, prefix) {
  return bytes.subarray(0, prefix.length).equals(Buffer.from(prefix));
}

// Do not unpack containers or reinterpret a renamed database as a web asset.
function isUninspectedContainer(bytes) {
  return [
    [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08],
    [0x1f, 0x8b], [0x42, 0x5a, 0x68], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00],
    [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07],
    Buffer.from('%PDF-'), Buffer.from('SQLite format 3\0'),
  ].some(prefix => hasPrefix(bytes, prefix)) || bytes.subarray(257, 262).toString('ascii') === 'ustar';
}

function isKnownBinaryAsset(bytes, extension) {
  switch (extension) {
    case '.woff2': return bytes.length >= 48 && hasPrefix(bytes, Buffer.from('wOF2')) && bytes.readUInt32BE(8) === bytes.length;
    case '.woff': return bytes.length >= 44 && hasPrefix(bytes, Buffer.from('wOFF')) && bytes.readUInt32BE(8) === bytes.length;
    case '.ttf': return hasPrefix(bytes, [0, 1, 0, 0]);
    case '.otf': return hasPrefix(bytes, Buffer.from('OTTO'));
    case '.png': return hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case '.jpg':
    case '.jpeg': return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case '.gif': return hasPrefix(bytes, Buffer.from('GIF87a')) || hasPrefix(bytes, Buffer.from('GIF89a'));
    case '.webp': return hasPrefix(bytes, Buffer.from('RIFF')) && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    case '.ico': return hasPrefix(bytes, [0, 0, 1, 0]);
    case '.wasm': return hasPrefix(bytes, [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
    default: return false;
  }
}

function isPrivateFile(name) {
  // Backups of a private file remain private even when their final extension changes.
  const base = name.replace(/(?:\.(?:bak|backup|old|orig|save|tmp)|~)+$/, '');
  return base.startsWith('.env') || base.startsWith('.dev.vars') || base.startsWith('dev.vars') ||
    [...privateNames].some(name => base === name || base.startsWith(`${name}.`) || base.startsWith(`${name}~`)) || base.endsWith('.log') ||
    /\.(?:db|sqlite|sqlite3)-(?:wal|shm|journal)$/.test(base) || privateExtensions.has(extname(base));
}

async function assertUnlinkedDirectoryPath(root) {
  const ancestors = [];
  for (let path = root; ; path = dirname(path)) {
    ancestors.push(path);
    if (dirname(path) === path) break;
  }
  // Check ancestors before the leaf: never traverse a junction to inspect its target.
  for (const path of ancestors.reverse()) {
    if (privateDirectories.has(basename(path).toLowerCase())) throw new Error('Private storage is not a build artifact');
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('An explicit unlinked build directory is required');
  }
}

/** Read-only packaging check. Never prints matched values or silently removes files. */
export async function checkDeploymentArtifact(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('An explicit build directory is required');
  const root = resolve(directory);
  const findings = [];
  let files = 0;
  const report = (path, rule) => findings.push({ path: relative(root, path).replaceAll('\\', '/') || '.', rule });
  async function visit(path) {
    const stat = await lstat(path);
    const name = basename(path).toLowerCase();
    if (stat.isSymbolicLink()) { report(path, 'unresolved-link'); return; }
    if (stat.isDirectory()) {
      if (privateDirectories.has(name)) { report(path, 'private-directory'); return; }
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
      return;
    }
    if (!stat.isFile()) { report(path, 'unsupported-file-type'); return; }
    files += 1;
    if (isPrivateFile(name)) {
      report(path, 'private-file'); return;
    }
    // A large uninspected artifact must be reviewed, not silently counted as safe.
    if (stat.size > 64 * 1024 * 1024) { report(path, 'file-too-large-to-inspect'); return; }
    const bytes = await readFile(path);
    if (bytes.length > 64 * 1024 * 1024) { report(path, 'file-too-large-to-inspect'); return; }
    if (isUninspectedContainer(bytes)) { report(path, 'uninspected-container'); return; }
    const text = bytes.toString('utf8');
    for (const [rule, pattern] of credentialPatterns) if (pattern.test(text)) report(path, rule);
    // A NUL or invalid UTF-8 must never disable inspection for the entire file.
    // Known image/font/wasm signatures permit ordinary binary assets, not arbitrary
    // binaries renamed to .png. This is NOT a decoder, PHI or steganography audit.
    if (isKnownBinaryAsset(bytes, extname(name))) return;
    if (bytes.includes(0)) { report(path, 'uninspected-binary'); return; }
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { report(path, 'uninspected-encoding'); }
  }
  await assertUnlinkedDirectoryPath(root);
  await visit(root);
  if (files === 0) findings.push({ path: '.', rule: 'empty-artifact' });
  return { files, findings, safe: findings.length === 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--dir' || !args[1]) {
    console.error('Usage: node scripts/check-deployment-artifact.mjs --dir <build-directory>');
    process.exitCode = 2;
  } else {
    try {
      const result = await checkDeploymentArtifact(args[1]);
      console.log(`Inspected ${result.files} artifact files. No file content or credential values are printed.`);
      for (const finding of result.findings) console.error(`${finding.path}: ${finding.rule}`);
      console.log(result.safe ? 'Artifact file policy passed. This does not establish runtime, authentication or clinical readiness.' : 'BLOCKED: do not upload this artifact. Source .gitignore alone does not protect generated bundles.');
      process.exitCode = result.safe ? 0 : 1;
    } catch {
      console.error('Artifact inspection failed; no upload should proceed. Check the explicit directory and file permissions.');
      process.exitCode = 2;
    }
  }
}
