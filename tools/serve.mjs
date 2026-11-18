// Local / LAN server for the simulator (no dependencies).
// Usage: node tools/serve.mjs [port]   -> prints URLs your teammates on the same network can open.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.tar': 'application/x-tar',
  '.gz': 'application/gzip', '.o': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file);
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.gz' ? 'public, max-age=86400' : 'no-cache' };
  const accepts = /gzip/.test(req.headers['accept-encoding'] || '');
  const compressible = ['.html', '.js', '.css', '.json', '.md'].includes(ext);
  if (accepts && compressible) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
  } else {
    headers['Content-Length'] = fs.statSync(file).size;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`웨이퍼 로봇 시뮬레이터 실행 중`);
  console.log(`  이 컴퓨터:   http://localhost:${port}/`);
  for (const addrs of Object.values(os.networkInterfaces()))
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  같은 네트워크: http://${a.address}:${port}/`);
});
