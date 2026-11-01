// Wspólna logika: używana przez serwer (autorytatywnie) i przez klienta (predykcja ruchu).
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;
export const RADIUS = 0.3;
export const SPEED = { walk: 2.4, run: 4.6, sneak: 1.25 };
export const CARRY_FACTOR = 0.72;

// Kafelki nieprzechodnie (drzwi L/V są nieprzechodnie, dopóki nie zostaną otwarte).
export const BLOCKING = new Set(['#', 'W', 'H', 'X', 'O', 'C', 'R', 'D', 'K', 'M', '$', 'b', 'p', 'Y', 'P', 'l', 'L', 'V']);
// Kafelki zasłaniające widok (okna i szklane drzwi są przezroczyste).
export const SIGHT_BLOCK = new Set(['#', 'H', 'O', 'Y', 'P', 'L', 'V']);
// Strefy, w których klient banku nie powinien przebywać.
export const RESTRICTED = new Set(['r', '_', ':', 'v', 'h']);
export const WALL_TILES = new Set(['#', 'W', 'V', 'H', 'L']);

export const ROLES = {
  haker:       { name: 'Haker',       color: '#3fd0c9', desc: 'Szybko zapętla kamery na stanowisku ochrony.' },
  akrobata:    { name: 'Akrobata',    color: '#a77bff', desc: 'Najszybszy w ekipie, także z workiem.' },
  kasiarz:     { name: 'Kasiarz',     color: '#ff9b3d', desc: 'Dwa razy szybciej otwiera zamki i naprawia wiertło.' },
  iluzjonista: { name: 'Iluzjonista', color: '#ff4d5e', desc: 'Zastrasza dalej i mocniej – strażnik poddaje się po jednym krzyku.' },
  miesniak:    { name: 'Mięśniak',    color: '#ffd23f', desc: 'Nosi worki bez spowolnienia i rzuca je dalej.' },
};

export const DIFFICULTIES = {
  latwy:    { name: 'Łatwy',           payout: 0.7, police: 150, detect: 0.6 },
  normalny: { name: 'Normalny',        payout: 1.0, police: 110, detect: 1.0 },
  trudny:   { name: 'Trudny',          payout: 1.4, police: 80,  detect: 1.35 },
  pro:      { name: 'Profesjonalista', payout: 2.0, police: 60,  detect: 1.7 },
};

export const key = (x, z) => x + ',' + z;

export function parseMap(def) {
  const rows = def.rows;
  const h = rows.length, w = rows[0].length;
  const spawns = [];
  for (let z = 0; z < h; z++) {
    if (rows[z].length !== w) throw new Error(`Mapa ${def.id}: wiersz ${z} ma długość ${rows[z].length}, oczekiwano ${w}`);
    for (let x = 0; x < w; x++) if (rows[z][x] === 'S') spawns.push({ x: x + 0.5, z: z + 0.5 });
  }
  const open = new Set(); // otwarte drzwi (L, V)
  return {
    ...def, w, h, spawns, open,
    at: (x, z) => (x < 0 || z < 0 || x >= w || z >= h) ? 'H' : rows[z][x],
  };
}

export function blockedAt(map, tx, tz) {
  const ch = map.at(tx, tz);
  if ((ch === 'L' || ch === 'V') && map.open.has(key(tx, tz))) return false;
  return BLOCKING.has(ch);
}

export function sightBlocked(map, tx, tz) {
  const ch = map.at(tx, tz);
  if ((ch === 'L' || ch === 'V') && map.open.has(key(tx, tz))) return false;
  return SIGHT_BLOCK.has(ch);
}

// Linia wzroku po siatce (krokami co 0.25 m).
export function lineOfSight(map, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
  const n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const x = x0 + dx * i / n, z = z0 + dz * i / n;
    if (sightBlocked(map, Math.floor(x), Math.floor(z))) return false;
  }
  return true;
}

// Wypycha okrąg z zablokowanych kafelków (AABB 1x1).
function resolve(map, p) {
  const r = RADIUS;
  for (let iter = 0; iter < 2; iter++) {
    const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
    const z0 = Math.floor(p.z - r), z1 = Math.floor(p.z + r);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      if (!blockedAt(map, tx, tz)) continue;
      const cx = Math.max(tx, Math.min(p.x, tx + 1));
      const cz = Math.max(tz, Math.min(p.z, tz + 1));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-8) {
        const opts = [[tx - r - p.x, 0], [tx + 1 + r - p.x, 0], [0, tz - r - p.z], [0, tz + 1 + r - p.z]];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += opts[0][0]; p.z += opts[0][1];
      } else {
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r; p.z = cz + dz / d * r;
      }
    }
  }
}

export function moveSpeed(p, mode) {
  let s = SPEED[mode];
  if (p.role === 'akrobata') s *= 1.12;
  if (p.carry) s *= p.role === 'miesniak' ? 1 : CARRY_FACTOR;
  return s;
}

// Jeden krok symulacji gracza. input: {mx, mz, run, sneak}
export function stepPlayer(map, p, input, dt = TICK_DT) {
  let mx = +input.mx || 0, mz = +input.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = len > 0.05;
  const canRun = !p.carry || p.role === 'miesniak';
  const mode = input.sneak ? 'sneak' : (input.run && canRun) ? 'run' : 'walk';
  if (moving) {
    const s = moveSpeed(p, mode) * dt;
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      p.x += mx * s / steps; resolve(map, p);
      p.z += mz * s / steps; resolve(map, p);
    }
    p.rot = Math.atan2(mx, mz);
    p.state = mode === 'walk' ? 1 : mode === 'run' ? 2 : 3;
  } else {
    p.state = input.sneak ? 4 : 0;
  }
  return p;
}

// Ruch postaci niezależnej (bez predykcji) – do punktu, z kolizją.
export function moveToward(map, p, tx, tz, speed, dt) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const s = Math.min(d, speed * dt);
  p.x += dx / d * s; p.z += dz / d * s;
  p.rot = Math.atan2(dx, dz);
  return d - s < 0.05;
}

// A* po siatce (8 kierunków, bez ścinania rogów). passDoors: strażnicy przechodzą przez drzwi L.
export function findPath(map, sx, sz, tx, tz, opts = {}) {
  const W = map.w, H = map.h;
  const ok = (x, z) => {
    if (x < 0 || z < 0 || x >= W || z >= H) return false;
    const ch = map.at(x, z);
    if (opts.passDoors && ch === 'L') return true;
    if (opts.allowed && !opts.allowed(ch)) return false;
    return !blockedAt(map, x, z);
  };
  sx = Math.floor(sx); sz = Math.floor(sz); tx = Math.floor(tx); tz = Math.floor(tz);
  if (!ok(tx, tz)) return null;
  const idx = (x, z) => z * W + x;
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1);
  const open = [[0, sx, sz]]; g[idx(sx, sz)] = 0;
  const hfn = (x, z) => Math.hypot(x - tx, z - tz);
  let guard = 0;
  while (open.length && guard++ < 6000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, x, z] = open[bi]; open.splice(bi, 1);
    if (x === tx && z === tz) {
      const path = []; let c = idx(x, z);
      while (c !== -1) { path.push([c % W + 0.5, Math.floor(c / W) + 0.5]); c = from[c]; }
      return path.reverse();
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz;
      if (!ok(nx, nz)) continue;
      if (dx && dz && (!ok(x + dx, z) || !ok(x, z + dz))) continue;
      const ng = g[idx(x, z)] + (dx && dz ? 1.414 : 1);
      if (ng < g[idx(nx, nz)]) { g[idx(nx, nz)] = ng; from[idx(nx, nz)] = idx(x, z); open.push([ng + hfn(nx, nz), nx, nz]); }
    }
  }
  return null;
}
