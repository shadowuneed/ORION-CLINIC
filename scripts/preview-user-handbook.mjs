// Loopback-only preview of the standalone handbook; no repository directory listing.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const file = new URL('../docs/user-guide/ORION-CLINIC-GUIDE.html', import.meta.url);
createServer(async (request, response) => {
  if (request.method !== 'GET' || !['/', '/ORION-CLINIC-GUIDE.html'].includes(request.url)) {
    response.writeHead(404).end(); return;
  }
  try {
    response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    response.end(await readFile(file));
  } catch {
    response.writeHead(500).end('Build the handbook first.');
  }
}).listen(3212, '127.0.0.1', () => console.log('Handbook: http://127.0.0.1:3212/'));
