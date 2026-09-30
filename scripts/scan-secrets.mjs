import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

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
    name: 'supabase-secret-key',
    pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'supabase-management-token',
    pattern: /\bsbp_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: 'postgresql-credentials',
    pattern: /\bpostgres(?:ql)?:\/\/[^\s"'<>/\\:@]+:([^\s"'<>@]+)@/gi,
    valueGroup: 1,
  },
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
    normalized.includes('your_') ||
    // Exact, confirmed UTF-8 hashing fixture; not a test-path exemption or a
    // general Russian-password prefix. This value is deliberately artificial.
    normalized === 'только искусственный пароль 🧪'
  );
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

// Only parsed JavaScript/TypeScript assignments can establish a dynamic RHS.
// A filename, sensitive variable name or source directory is never allowlisted.
// Unknown syntax and literal-bearing expressions retain the conservative rule.
function assignmentSyntax(filePath, text) {
  const extension = extname(filePath).toLowerCase();
  const empty = { dynamic: new Set(), literals: new Set() };
  if (!['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(extension)) return empty;
  const kind = extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.jsx' ? ts.ScriptKind.JSX :
    ['.js', '.mjs', '.cjs'].includes(extension) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, kind);
  if (source.parseDiagnostics.length) return empty;
  const indices = new Set();
  const literals = new Set();
  const sensitiveName = /^(?:API_KEY|AUTH_TOKEN|AUTHTOKEN|CLIENT_SECRET|GROQ_API_KEY|NGROK_AUTHTOKEN|OPENAI_API_KEY|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)$/i;
  let symbolShadowed = false;
  function inspectBindings(node) {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isImportSpecifier(node) || ts.isImportClause(node)) &&
        node.name && ts.isIdentifier(node.name) && node.name.text === 'Symbol') symbolShadowed = true;
    ts.forEachChild(node, inspectBindings);
  }
  inspectBindings(source);
  function dynamic(node) {
    if (ts.isIdentifier(node)) return true;
    if (ts.isPropertyAccessExpression(node)) return dynamic(node.expression);
    if (ts.isElementAccessExpression(node)) return dynamic(node.expression) &&
      (ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression) || dynamic(node.argumentExpression));
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return dynamic(node.expression);
    // A standard Symbol marker is not serializable authentication material.
    // Do not exempt String/Buffer wrappers, shadowed Symbol bindings or keys
    // embedded in labels (known credential-pattern rules still scan all bytes).
    if (ts.isCallExpression(node) && !symbolShadowed && ts.isIdentifier(node.expression) && node.expression.text === 'Symbol' &&
        node.arguments.length <= 1 && node.arguments.every(argument => ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) return true;
    // This exact invalid header/signature pair is a confirmed fake JWT fixture,
    // not a valid bearer token or a broad template-expression exemption.
    if (ts.isTemplateExpression(node) && node.head.text === 'example.' && node.templateSpans.length === 1 &&
        node.templateSpans[0].literal.text === '.example') return true;
    if (ts.isCallExpression(node)) return dynamic(node.expression) && node.arguments.every(argument => {
      if (ts.isNumericLiteral(argument)) return argument.text.length < 12;
      if (argument.kind === ts.SyntaxKind.TrueKeyword ||
          argument.kind === ts.SyntaxKind.FalseKeyword || argument.kind === ts.SyntaxKind.NullKeyword) return true;
      if (ts.isStringLiteral(argument)) return argument.text.length < 12 || isPlaceholder(argument.text);
      return dynamic(argument);
    });
    return false;
  }
  function staticText(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return staticText(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticText(node.left), right = staticText(node.right);
      return left !== null && right !== null ? left + right : null;
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map(staticText);
      return values.every(value => value !== null) ? values.join('') : null;
    }
    if (ts.isTemplateExpression(node)) {
      const values = node.templateSpans.map(span => staticText(span.expression));
      return values.every(value => value !== null) ? node.head.text + node.templateSpans.map((span, index) => values[index] + span.literal.text).join('') : null;
    }
    return null;
  }
  function containsCredentialLiteral(node) {
    const value = staticText(node);
    if (value !== null && value.length >= 12 && !isPlaceholder(value)) return true;
    if (ts.isTemplateExpression(node)) {
      const fragments = node.head.text + node.templateSpans.map(span => span.literal.text).join('');
      if (fragments.length >= 12 && !isPlaceholder(fragments)) return true;
    }
    let found = false;
    ts.forEachChild(node, child => { if (containsCredentialLiteral(child)) found = true; });
    return found;
  }
  function inspect(name, initializer) {
    if (!ts.isIdentifier(name) || !sensitiveName.test(name.text) || !initializer) return;
    const index = name.getStart(source);
    if (dynamic(initializer)) indices.add(index);
    else if (containsCredentialLiteral(initializer)) literals.add(index);
  }
  function visit(node) {
    if (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) inspect(node.name, node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) inspect(node.left, node.right);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { dynamic: indices, literals };
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

export function scanRepositoryText(filePath, text) {
  const findings = [];
  const assignments = assignmentSyntax(filePath, text);
  for (const index of assignments.literals) findings.push({ filePath, line: lineNumberAt(text, index), rule: 'sensitive-assignment' });

  for (const rule of secretRules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.name === 'sensitive-assignment' && assignments.dynamic.has(match.index)) continue;
      const value = rule.valueGroup ? match[rule.valueGroup] : undefined;
      if (value && isPlaceholder(value)) continue;

      findings.push({
        filePath,
        line: lineNumberAt(text, match.index ?? 0),
        rule: rule.name,
      });
    }
  }

  return [...new Map(findings.map(finding => [`${finding.line}:${finding.rule}`, finding])).values()];
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
    findings.push(...scanRepositoryText(filePath, buffer.toString('utf8')));
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
