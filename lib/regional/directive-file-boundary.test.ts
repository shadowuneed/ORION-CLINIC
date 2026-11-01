import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { directiveAttachmentDisposition, directiveFileBytes, readDirectiveJson, validateDirectiveFiles } from '../../scripts/directive-file-boundary';

const file = { fileName: 'Отчёт.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Выполнено').toString('base64') };
function request(bytes: Buffer | string, headers: Record<string, string> = {}) {
  const req = Readable.from([Buffer.from(bytes)]) as unknown as IncomingMessage;
  Object.assign(req, { headers }); return req;
}
describe('private directive document boundary', () => {
  it('computes size and digest from bytes, not supplied metadata', () => {
    expect(directiveFileBytes(file)).toMatchObject({ byteLength: Buffer.byteLength('Выполнено'), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it.each(['../report.txt', 'folder\\report.txt', 'a\r\nHeader.txt', 'file:ads.txt', 'report.txt.', 'report.txt '])('rejects unsafe file name %s', fileName => {
    expect(() => directiveFileBytes({ ...file, fileName })).toThrow();
  });
  it.each(['AA=', 'AB==', 'a', '', 'aGVs bG8=', '____'])('rejects noncanonical base64 %s', contentBase64 => {
    expect(() => directiveFileBytes({ ...file, contentBase64 })).toThrow();
  });
  it('rejects HTML, SVG, executables and header/type mismatch', () => {
    for (const [fileName, mimeType] of [['x.html', 'text/html'], ['x.svg', 'image/svg+xml'], ['x.exe', 'application/octet-stream'], ['x.pdf', 'application/pdf'], ['x.png', 'image/png'], ['x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
      expect(() => directiveFileBytes({ ...file, fileName, mimeType })).toThrow();
    }
  });
  it('bounds individual bytes and document count', () => {
    expect(() => validateDirectiveFiles([file, file, file, file])).toThrow();
    expect(() => directiveFileBytes({ ...file, contentBase64: Buffer.alloc(2 * 1024 * 1024 + 1, 65).toString('base64') })).toThrow();
  });
  it('validates text UTF8 and rejects binary controls', () => {
    for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0])]) expect(() => directiveFileBytes({ ...file, contentBase64: bytes.toString('base64') })).toThrow();
  });
  it('forces an encoded attachment disposition without interpreting the name', () => {
    const value = directiveAttachmentDisposition('Отчёт "x"\r\n.txt');
    expect(value).toMatch(/^attachment; filename="document"; filename\*=UTF-8''/);
    expect(value).not.toMatch(/[\r\n]/); expect(value).toContain('%0D%0A');
  });
  it('reads bounded strict UTF8 JSON', async () => {
    await expect(readDirectiveJson(request('{"type":"create"}'))).resolves.toEqual({ type: 'create' });
    await expect(readDirectiveJson(request('{no}'))).rejects.toMatchObject({ status: 400 });
    await expect(readDirectiveJson(request(Buffer.from([0xff])))).rejects.toMatchObject({ status: 400 });
  });
  it.each([{ 'content-length': '9437185' }, { 'content-length': '-1' }, { 'content-length': '1e8' }])('rejects unsafe declared size %#', async headers => {
    await expect(readDirectiveJson(request('{}', headers))).rejects.toMatchObject({ status: 413 });
  });
  it('enforces actual streamed size even with a false content length', async () => {
    await expect(readDirectiveJson(request(Buffer.alloc(9 * 1024 * 1024 + 1), { 'content-length': '2' }))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects compressed bodies instead of inflating untrusted uploads', async () => {
    await expect(readDirectiveJson(request('{}', { 'content-encoding': 'gzip' }))).rejects.toMatchObject({ status: 415 });
  });
});
