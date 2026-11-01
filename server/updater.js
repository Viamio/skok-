// Aktualizacje z GitHuba: sprawdzenie wersji, pobranie archiwum, podmiana plików, restart.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import https from 'node:https';

export const REPO = 'Viamio/skok-';
export const BRANCH = 'main';
// Te ścieżki są podmieniane. Folder data/ (zapis ekip) nigdy nie jest ruszany.
const MANAGED = ['server', 'shared', 'public', 'package.json', 'README.md', 'START.bat', 'version.json'];

export function localVersion(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')); }
  catch { return { version: 0, name: '?' }; }
}

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'skok-updater', 'Cache-Control': 'no-cache' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume(); resolve(get(new URL(res.headers.location, url).toString(), redirects - 1)); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub odpowiedział kodem ${res.statusCode}`)); return; }
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

export async function remoteVersion() {
  const buf = await get(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/version.json?t=${Date.now()}`);
  return JSON.parse(buf.toString('utf8'));
}

// Prosty czytnik archiwum .tar (po rozpakowaniu gzip).
export function untar(buf) {
  const files = [];
  let off = 0, longName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    let name = str(0, 100);
    const prefix = str(345, 500);
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (longName) { name = longName; longName = null; }
    if (type === 'x' || type === 'g') continue;          // nagłówki rozszerzone
    if (type === '0' || type === '\0' || type === '7') files.push({ name, data });
  }
  return files;
}

export async function installUpdate(root, log = () => {}) {
  log('Pobieram nową wersję z GitHuba…');
  const tgz = await get(`https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`);
  const files = untar(zlib.gunzipSync(tgz));
  if (!files.length) throw new Error('Puste archiwum');
  // GitHub pakuje wszystko w folder „skok-main/”.
  const strip = (n) => n.split('/').slice(1).join('/');
  const entries = files.map((f) => ({ rel: strip(f.name), data: f.data })).filter((f) => f.rel && MANAGED.some((m) => f.rel === m || f.rel.startsWith(m + '/')));
  if (!entries.some((e) => e.rel === 'server/server.js')) throw new Error('W archiwum brakuje server/server.js – przerywam');
  log(`Instaluję ${entries.length} plików…`);
  // najpierw zapis do folderu tymczasowego, potem podmiana – żeby nie zostawić połowicznej instalacji
  const tmp = path.join(root, '.update-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const e of entries) {
    const dest = path.join(tmp, e.rel);
    if (!dest.startsWith(tmp)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data);
  }
  for (const m of MANAGED) {
    const src = path.join(tmp, m);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(root, m);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(src, dest);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  log('Gotowe.');
}
