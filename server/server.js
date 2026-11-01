// Serwer gry „Skok”: pliki statyczne + WebSocket + pokoje + symulacja 20 razy na sekundę.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handleUpgrade } from './ws.js';
import { Crews } from './crews.js';
import { MAPS } from '../shared/maps.js';
import { stepPlayer, ROLES, DIFFICULTIES, TICK_RATE } from '../shared/sim.js';
import { Heist } from './heist.js';
import { localVersion, remoteVersion, installUpdate } from './updater.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 3000;
const crews = new Crews(path.join(ROOT, 'data', 'crews.json'));
const MAX_PLAYERS = 5;

// ---------- pliki statyczne ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};
const MOUNTS = [['/shared/', path.join(ROOT, 'shared')], ['/', path.join(ROOT, 'public')]];

// ---------- aktualizacje ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
// Aktualizować może tylko komputer, na którym działa serwer (nie znajomi przez tunel).
const isHostMachine = (req) => {
  const a = req.socket.remoteAddress || '';
  const local = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  return local && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
};
let updating = false;
async function handleApi(req, res, url) {
  if (url === '/api/version') return json(res, 200, { ...localVersion(ROOT), host: isHostMachine(req) });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
  if (url === '/api/check') {
    try {
      const local = localVersion(ROOT), remote = await remoteVersion();
      return json(res, 200, { local, remote, available: (remote.version || 0) > (local.version || 0) });
    } catch (e) { return json(res, 200, { error: 'Nie udało się połączyć z GitHubem: ' + e.message }); }
  }
  if (url === '/api/update') {
    if (!isHostMachine(req)) return json(res, 403, { error: 'Aktualizować może tylko osoba, u której działa serwer.' });
    if ([...rooms.values()].some((r) => r.phase === 'game')) return json(res, 409, { error: 'Trwa napad – poczekajcie do końca, potem aktualizuj.' });
    if (updating) return json(res, 409, { error: 'Aktualizacja już trwa.' });
    updating = true;
    try {
      await installUpdate(ROOT, (m) => console.log('  [aktualizacja] ' + m));
      json(res, 200, { ok: true, restart: !!process.env.SKOK_LAUNCHER });
      for (const r of rooms.values()) broadcast(r, { t: 'ev', text: 'Host aktualizuje grę – za chwilę odśwież stronę.', kind: 'info' });
      if (process.env.SKOK_LAUNCHER) setTimeout(() => process.exit(42), 400);
    } catch (e) { updating = false; json(res, 500, { error: 'Aktualizacja nie wyszła: ' + e.message }); }
    return;
  }
  json(res, 404, { error: 'brak' });
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.startsWith('/api/')) { handleApi(req, res, url).catch((e) => json(res, 500, { error: e.message })); return; }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Nie znaleziono'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end();
});

// ---------- pokoje ----------
const rooms = new Map();
let nextId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function roomView(room) {
  const crew = crews.get(room.crewName);
  return {
    code: room.code, crew: room.crewName, host: room.hostId, phase: room.phase,
    difficulty: room.difficulty, map: room.mapId,
    players: [...room.players.values()].map(p => ({
      id: p.id, nick: p.nick, role: p.role, ready: p.ready, wallet: crew?.wallets[p.nick] ?? 0,
    })),
  };
}

function broadcast(room, msg) { for (const p of room.players.values()) p.conn.send(msg); }
function sendRoom(room) { broadcast(room, { t: 'room', room: roomView(room) }); }

function cleanNick(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 16); }

function joinRoom(conn, room, nick) {
  if (room.players.size >= MAX_PLAYERS) return conn.send({ t: 'err', msg: 'Pokój jest pełny (max 5 osób).' });
  if (room.phase !== 'lobby') return conn.send({ t: 'err', msg: 'Napad już trwa. Poczekaj, aż ekipa wróci do lobby.' });
  if ([...room.players.values()].some(p => p.nick.toLowerCase() === nick.toLowerCase()))
    return conn.send({ t: 'err', msg: 'Ktoś w pokoju ma już taki nick.' });
  const crew = crews.get(room.crewName);
  crews.ensureMember(crew, nick);
  const p = {
    id: nextId++, nick, conn, role: null, ready: false,
    x: 0, z: 0, rot: 0, state: 0, inputs: [], lastInput: { mx: 0, mz: 0, run: false, sneak: false }, lastSeq: 0,
  };
  room.players.set(p.id, p);
  conn.player = p; conn.room = room;
  conn.send({ t: 'joined', you: p.id, crew: crews.publicView(crew) });
  sendRoom(room);
}

function leave(conn) {
  const room = conn.room, p = conn.player;
  if (!room || !p) return;
  room.players.delete(p.id);
  conn.room = conn.player = null;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.hostId === p.id) room.hostId = room.players.keys().next().value;
  broadcast(room, { t: 'left', id: p.id, nick: p.nick });
  sendRoom(room);
}

function startGame(room) {
  room.phase = 'game';
  room.tick = 0;
  room.resultSent = false;
  room.heist = new Heist(room, MAPS[room.mapId], room.difficulty, (msg) => broadcast(room, msg));
  const map = room.heist.map;
  room.map = map;
  let i = 0;
  for (const p of room.players.values()) {
    const s = map.spawns[i++ % map.spawns.length];
    Object.assign(p, { x: s.x, z: s.z, rot: Math.PI, state: 0, inputs: [], lastSeq: 0, lastInput: { mx: 0, mz: 0, run: false, sneak: false },
      masked: false, carry: false, ties: 4, act: null });
  }
  broadcast(room, {
    t: 'start', map: room.mapId, difficulty: room.difficulty, npcs: room.heist.npcInfo(),
    players: [...room.players.values()].map(p => ({ id: p.id, nick: p.nick, role: p.role, x: p.x, z: p.z, rot: p.rot })),
  });
  room.heist.sendState();
}

function finishRoom(room) {
  const r = room.heist.result;
  const crew = crews.get(room.crewName);
  for (const p of room.players.values()) crew.wallets[p.nick] = (crew.wallets[p.nick] || 0) + r.cut;
  crew.stats.heists++; if (r.success) crew.stats.success++; crew.stats.earned += r.total;
  crews.save();
  room.phase = 'results';
  broadcast(room, { t: 'end', ...r, wallets: Object.fromEntries([...room.players.values()].map(p => [p.nick, crew.wallets[p.nick]])) });
  sendRoom(room);
}

function onMessage(conn, m) {
  const room = conn.room, me = conn.player;
  switch (m.t) {
    case 'hello':
      conn.send({ t: 'hello', roles: ROLES, difficulties: DIFFICULTIES });
      break;
    case 'crewLogin': {
      const nick = cleanNick(m.nick);
      if (nick.length < 2) return conn.send({ t: 'err', msg: 'Nick musi mieć co najmniej 2 znaki.' });
      const r = crews.login(m.name, m.pass, !!m.create);
      if (r.error) return conn.send({ t: 'err', msg: r.error });
      if (conn.room) leave(conn);
      const code = makeCode();
      const newRoom = { code, crewName: r.crew.name, hostId: null, phase: 'lobby', difficulty: 'normalny', mapId: 'bank', players: new Map() };
      rooms.set(code, newRoom);
      joinRoom(conn, newRoom, nick);
      newRoom.hostId = conn.player.id;
      sendRoom(newRoom);
      break;
    }
    case 'joinRoom': {
      const nick = cleanNick(m.nick);
      if (nick.length < 2) return conn.send({ t: 'err', msg: 'Nick musi mieć co najmniej 2 znaki.' });
      const r = rooms.get(String(m.code || '').trim().toUpperCase());
      if (!r) return conn.send({ t: 'err', msg: 'Nie ma pokoju o takim kodzie.' });
      if (conn.room) leave(conn);
      joinRoom(conn, r, nick);
      break;
    }
    case 'pickRole': {
      if (!room || room.phase !== 'lobby') return;
      if (m.role !== null && !ROLES[m.role]) return;
      if (m.role && [...room.players.values()].some(p => p !== me && p.role === m.role))
        return conn.send({ t: 'err', msg: 'Tę postać wybrał już ktoś inny.' });
      me.role = m.role; me.ready = false;
      sendRoom(room);
      break;
    }
    case 'setDifficulty':
      if (!room || room.hostId !== me.id || !DIFFICULTIES[m.d]) return;
      room.difficulty = m.d; sendRoom(room);
      break;
    case 'ready':
      if (!room || room.phase !== 'lobby') return;
      if (!me.role) return conn.send({ t: 'err', msg: 'Najpierw wybierz postać.' });
      me.ready = !!m.v; sendRoom(room);
      break;
    case 'start': {
      if (!room || room.hostId !== me.id || room.phase !== 'lobby') return;
      const ps = [...room.players.values()];
      if (ps.some(p => !p.role || !p.ready)) return conn.send({ t: 'err', msg: 'Wszyscy muszą wybrać postać i być gotowi.' });
      startGame(room);
      break;
    }
    case 'input': {
      if (!room || room.phase !== 'game') return;
      const inp = { mx: +m.mx || 0, mz: +m.mz || 0, run: !!m.run, sneak: !!m.sneak, seq: m.seq | 0 };
      if (me.inputs.length < 30) me.inputs.push(inp);
      break;
    }
    case 'mask':
      if (room?.phase === 'game') room.heist.mask(me);
      break;
    case 'shout':
      if (room?.phase === 'game') room.heist.shout(me, +m.yaw || 0);
      break;
    case 'act':
      if (room?.phase === 'game') room.heist.setAct(me, typeof m.id === 'string' ? m.id : null);
      break;
    case 'throw':
      if (room?.phase === 'game') room.heist.throwBag(me, +m.yaw || 0);
      break;
    case 'dbg': // tylko do testów: SKOK_DEBUG=1
      if (process.env.SKOK_DEBUG && room?.phase === 'game') { me.x = +m.x; me.z = +m.z; if (m.mask) room.heist.mask(me); }
      break;
    case 'ping':
      if (!room || room.phase !== 'game') return;
      if (Date.now() - (me.lastPing || 0) < 300) return;
      me.lastPing = Date.now();
      broadcast(room, { t: 'ping', id: me.id, x: +m.x || 0, z: +m.z || 0, kind: m.kind === 'danger' ? 'danger' : 'go' });
      break;
    case 'toLobby':
      if (!room || room.hostId !== me.id) return;
      room.phase = 'lobby'; room.heist = null;
      for (const p of room.players.values()) p.ready = false;
      broadcast(room, { t: 'toLobby' });
      sendRoom(room);
      break;
    case 'leave':
      leave(conn);
      conn.send({ t: 'leftOk' });
      break;
  }
}

// ---------- pętla gry ----------
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase !== 'game') continue;
    room.tick++;
    for (const p of room.players.values()) {
      // Przetwarzamy 1 wejście na tick; jeśli klient wysłał za dużo, nadrabiamy (max 3).
      // Brak wejścia w tym ticku = pakiet się spóźnił; czekamy, nie ruszamy gracza.
      const count = p.inputs.length > 4 ? 3 : 1;
      for (let i = 0; i < count; i++) {
        const inp = p.inputs.shift();
        if (!inp) break;
        p.lastInput = inp; p.lastSeq = inp.seq;
        stepPlayer(room.map, p, inp);
      }
    }
    room.heist.tick();
    const snap = [...room.players.values()].map(p => [p.id, +p.x.toFixed(3), +p.z.toFixed(3), +p.rot.toFixed(3), p.state, p.lastSeq,
      p.masked ? 1 : 0, p.carry ? 1 : 0, p.act ? +p.act.prog.toFixed(2) : -1, p.ties]);
    broadcast(room, { t: 'snap', tick: room.tick, p: snap, n: room.heist.npcSnapshot() });
    if (room.heist.result && !room.resultSent) { room.resultSent = true; finishRoom(room); }
  }
}, 1000 / TICK_RATE);

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  handleUpgrade(req, socket, (conn) => {
    conn.on('message', (m) => { try { onMessage(conn, m); } catch (e) { console.error(e); } });
    conn.on('close', () => leave(conn));
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('\n  !!! Port ' + PORT + ' jest zajęty – prawdopodobnie działa jeszcze STARA wersja gry.');
    console.log('  !!! Zamknij wszystkie czarne okna serwera gry i uruchom START.bat ponownie.\n');
  } else console.error(e);
  process.exit(1);
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n  SKOK – serwer działa (wersja: ${localVersion(ROOT).name})`);
  console.log(`  Na tym komputerze:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  W tej samej sieci:  http://${ip}:${PORT}`);
  console.log('  Przez internet: zobacz README.md (Cloudflare Tunnel)\n');
});
