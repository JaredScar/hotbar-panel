import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const types: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function resolveUiFile(root: string, requestPath: string): { file: string; missing: boolean } {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const relative = path.normalize(decoded).replace(/^([/\\])+/, '');
  const base = path.resolve(root);
  const candidate = path.resolve(base, relative);
  if (candidate !== base && !candidate.startsWith(base + path.sep)) {
    return { file: path.join(base, 'index.html'), missing: true };
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { file: candidate, missing: false };
  if (path.extname(relative)) return { file: candidate, missing: true };
  return { file: path.join(base, 'index.html'), missing: false };
}

export function serveUi(root: string): Promise<string> {
  const server = http.createServer((request, response) => {
    const resolved = resolveUiFile(root, request.url ?? '/');
    if (resolved.missing || !fs.existsSync(resolved.file)) {
      response.writeHead(404).end();
      return;
    }
    const body = fs.readFileSync(resolved.file);
    const type = types[path.extname(resolved.file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    response.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}
