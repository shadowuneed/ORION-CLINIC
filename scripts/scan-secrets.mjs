import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const maxTextFileBytes = 4 * 1024 * 1024;
const syntheticFixturePrefix = 'tests/fixtures/synthetic/';

const forbiddenArtifactExtensions = new Set([
  '.db',
  '.dcm',
  '.docx',
  '.flac',
  '.key',
  '.m4a',
  '.mp3',
  '.ogg',
  '.p12',
  '.pdf',
  '.pfx',
  '.rtf',
  '.sqlite',
  '.sqlite3',
  '.wav',
  '.webm',
  '.zip',
]);

const secretRules = [
  {
    name: 'groq-api-key',
    pattern: /\bgsk_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: 'openai-api-key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'sensitive-assignment',
    pattern:
      /\b(?:API_KEY|AUTH_TOKEN|AUTHTOKEN|CLIENT_SECRET|GROQ_API_KEY|NGROK_AUTHTOKEN|OPENAI_API_KEY|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)\s*[:=]\s*["']?([^\s"',;]{12,})/gi,
    valueGroup: 1,
  },
];

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('${') ||
    normalized.includes('<') ||
    normalized.includes('changeme') ||
    normalized.includes('dummy') ||
    normalized.includes('example') ||
    normalized.includes('placeholder') ||
    normalized.includes('replace') ||
    normalized.includes('synthetic') ||
    normalized.includes('your_')
  );
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function getRepositoryFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: projectRoot,
      encoding: 'buffer',
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim();
    throw new Error(
      `Unable to enumerate repository files${detail ? `: ${detail}` : ''}`,
    );
  }

  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .sort();
}

function scanText(filePath, text) {
  const findings = [];

  for (const rule of secretRules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = rule.valueGroup ? match[rule.valueGroup] : undefined;
      if (value && isPlaceholder(value)) continue;

      findings.push({
        filePath,
        line: lineNumberAt(text, match.index ?? 0),
        rule: rule.name,
      });
    }
  }

  return findings;
}

function main() {
  const findings = [];
  const repositoryFiles = getRepositoryFiles();

  for (const filePath of repositoryFiles) {
    const extension = extname(filePath).toLowerCase();
    if (
      forbiddenArtifactExtensions.has(extension) &&
      !filePath.startsWith(syntheticFixturePrefix)
    ) {
      findings.push({ filePath, line: 1, rule: 'clinical-artifact-location' });
      continue;
    }

    const buffer = readFileSync(resolve(projectRoot, filePath));
    if (buffer.length > maxTextFileBytes || buffer.includes(0)) continue;
    findings.push(...scanText(filePath, buffer.toString('utf8')));
  }

  if (findings.length > 0) {
    console.error('Security policy failed. Potential sensitive material was found:');
    for (const finding of findings) {
      console.error(`- ${finding.filePath}:${finding.line} (${finding.rule})`);
    }
    console.error('No matched value was printed. Remove it and rotate any exposed credential.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `Security policy passed for ${repositoryFiles.length} tracked and untracked repository files.`,
  );
}

main();
