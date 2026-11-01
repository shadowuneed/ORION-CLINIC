import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const DIRECTIVE_HTTP_MAX_BYTES = 9 * 1024 * 1024;
const FILE_MAX_BYTES = 2 * 1024 * 1024;
export class DirectiveBoundaryError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** No public upload directory. The command and its documents commit together. */
export async function readDirectiveJson(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > DIRECTIVE_HTTP_MAX_BYTES)) {
    throw new DirectiveBoundaryError('BODY_TOO_LARGE', 413);
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new DirectiveBoundaryError('UNSUPPORTED_ENCODING', 415);
  }
  let length = 0;
  const chunks: Buffer[] = [];
  const timeout = setTimeout(() => request.destroy(), 15000);
  try {
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > DIRECTIVE_HTTP_MAX_BYTES) throw new DirectiveBoundaryError('BODY_TOO_LARGE', 413);
      chunks.push(bytes);
    }
  } finally { clearTimeout(timeout); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new DirectiveBoundaryError('DIRECTIVE_INVALID_COMMAND', 400); }
}

export type DirectiveFileInput = { fileName: string; mimeType: string; contentBase64: string };
/** Header checks are not antivirus scanning. Download stays attachment-only. */
export function directiveFileBytes(file: DirectiveFileInput) {
  const reject = () => { throw new DirectiveBoundaryError('DIRECTIVE_INVALID_ATTACHMENT', 400); };
  if (!file.fileName || file.fileName.length > 180 || /[\x00-\x1f\x7f/\\:]/.test(file.fileName) ||
    file.fileName === '.' || file.fileName === '..' || /[. ]$/.test(file.fileName)) reject();
  if (!file.contentBase64 || file.contentBase64.length > Math.ceil(FILE_MAX_BYTES / 3) * 4 ||
    file.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.contentBase64)) reject();
  const bytes = Buffer.from(file.contentBase64, 'base64');
  if (!bytes.length || bytes.length > FILE_MAX_BYTES || bytes.toString('base64') !== file.contentBase64) reject();
  const extension = file.fileName.toLowerCase().split('.').at(-1);
  const prefix = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  switch (file.mimeType) {
    case 'application/pdf': if (extension !== 'pdf' || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') reject(); break;
    case 'image/png': if (extension !== 'png' || !prefix('89504e470d0a1a0a')) reject(); break;
    case 'image/jpeg': if (!['jpg', 'jpeg'].includes(extension ?? '') || !prefix('ffd8ff')) reject(); break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      if (extension !== 'docx' || !prefix('504b0304') || !bytes.includes(Buffer.from('[Content_Types].xml')) || !bytes.includes(Buffer.from('word/document.xml'))) reject();
      break;
    case 'text/plain':
      if (extension !== 'txt') reject();
      try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) reject(); }
      catch { reject(); }
      break;
    default: reject();
  }
  return { bytes, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function validateDirectiveFiles(files: readonly DirectiveFileInput[]) {
  if (files.length > 3) throw new DirectiveBoundaryError('DIRECTIVE_INVALID_ATTACHMENT', 400);
  const decoded = files.map(directiveFileBytes);
  if (decoded.reduce((sum, file) => sum + file.byteLength, 0) > 6 * 1024 * 1024) throw new DirectiveBoundaryError('BODY_TOO_LARGE', 413);
}

export function directiveAttachmentDisposition(fileName: string) {
  // A fixed ASCII fallback prevents header injection; Unicode is RFC 5987 encoded.
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="document"; filename*=UTF-8''${encoded}`;
}
