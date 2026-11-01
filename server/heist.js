// Przebieg napadu: postacie niezależne, wykrywanie, zastraszanie, łup, alarm, wynik.
import {
  parseMap, key, findPath, moveToward, lineOfSight, blockedAt, RESTRICTED, DIFFICULTIES, TICK_DT,
} from '../shared/sim.js';

const ST = { calm: 0, panic: 1, down: 2, tied: 3, flee: 4, alert: 5, calling: 6, surrender: 7, escaped: 8 };
const CIV_COLORS = ['#9a3434', '#3b5a8a', '#4f7a45', '#c9a24a', '#6b4a7a', '#2f7a78', '#b8743c', '#d8d4cc', '#a85a6a', '#e0c9a6', '#3a3a3a'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class Heist {
  constructor(room, mapDef, difficulty, send) {
    this.room = room;
    this.map = parseMap(mapDef);
    this.def = mapDef;
    this.diff = DIFFICULTIES[difficulty] || DIFFICULTIES.normalny;
    this.difficulty = difficulty;
    this.send = send; // (msg) => broadcast
    this.t = 0; this.tickN = 0;
    this.alarm = false; this.alarmReason = ''; this.policeT = 0;
    this.ended = false;
    this.looped = false;
    this.keycard = 'desk';       // 'desk' | id gracza
    this.vault = 'closed';       // closed | drilling | open
    this.drill = { prog: 0, jam: false, jams: [0.33, 0.7] };
    this.bags = [];              // worki leżące: {id, x, z}
    this.nextBag = 1;
    this.secured = 0; this.loose = 0;
    this.escapeT = 0;
    this.npcs = [];
    this.nextNpc = 1000;
    this.buildInteractables();
    this.spawnNpcs();
  }

  // ---------- przygotowanie ----------
  buildInteractables() {
    const m = this.map;
    this.items = new Map();
    let firstM = true;
    for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) {
      const ch = m.at(x, z), k = key(x, z), cx = x + 0.5, cz = z + 0.5;
      if (ch === 'R') this.items.set(k, { id: k, kind: 'register', x: cx, z: cz, done: false });
      if (ch === 'K') this.items.set(k, { id: k, kind: 'keycard', x: cx, z: cz, done: false });
      if (ch === 'M' && firstM) { firstM = false; this.items.set(k, { id: k, kind: 'cameras', x: cx, z: cz, done: false }); }
      if (ch === 'L') this.items.set(k, { id: k, kind: 'door', x: cx, z: cz, done: false });
      if (ch === 'V') this.items.set(k, { id: k, kind: 'vault', x: cx, z: cz, done: false });
      if (ch === '$') this.items.set(k, { id: k, kind: 'cash', x: cx, z: cz, done: false });
    }
    this.cashTotal = [...this.items.values()].filter((i) => i.kind === 'cash').length;
    this.zone = new Set();
    this.exits = [];
    for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) {
      if (m.at(x, z) === 'Z') this.zone.add(key(x, z));
      if (m.at(x, z) === '-' && (x === 1 || x === m.w - 2)) this.exits.push([x + 0.5, z + 0.5]);
    }
    const tiles = (pred) => { const out = []; for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) if (pred(m.at(x, z), x, z)) out.push([x + 0.5, z + 0.5]); return out; };
    this.lobbyTiles = tiles((ch) => ch === '.');
    this.sidewalk = tiles((ch, x, z) => ch === '-' && z === 22);
  }

  addNpc(kind, x, z, extra = {}) {
    const n = {
      id: this.nextNpc++, kind, x, z, rot: rnd(-Math.PI, Math.PI), anim: 0, state: 'calm', susp: 0,
      timer: 0, path: null, wait: rnd(0, 4), color: pick(CIV_COLORS), shouts: 0, shoutT: 0, seeT: 0, ...extra,
    };
    this.npcs.push(n);
    return n;
  }

  spawnNpcs() {
    const d = this.def;
    for (const g of d.guards) {
      const [x, z] = g.route[0];
      this.addNpc('guard', x + 0.5, z + 0.5, { route: g.route, ri: 0, post: !!g.post, security: !!g.security, color: '#1d2b4a' });
    }
    for (const [x, z] of d.tellers) this.addNpc('teller', x + 0.5, z + 0.5, { rot: Math.PI, home: [x + 0.5, z + 0.5], color: '#e8e2d4' });
    this.addNpc('manager', d.manager[0] + 0.5, d.manager[1] + 0.5, { home: [d.manager[0] + 0.5, d.manager[1] + 0.5], color: '#2a2a30' });
    for (let i = 0; i < d.civilians; i++) { const [x, z] = pick(this.lobbyTiles); this.addNpc('civ', x, z); }
    for (let i = 0; i < d.pedestrians; i++) { const [x, z] = pick(this.sidewalk); this.addNpc('ped', x, z); }
    this.securityGuard = this.npcs.find((n) => n.security);
  }

  players() { return [...this.room.players.values()]; }

  ev(text, kind = 'info') { this.send({ t: 'ev', text, kind }); }

  raiseAlarm(reason) {
    if (this.alarm || this.ended) return;
    this.alarm = true; this.alarmReason = reason;
    this.policeT = this.diff.police;
    this.ev(`ALARM! ${reason}. Policja będzie za ${this.policeT} s – pakujcie łup i do furgonetki!`, 'bad');
    for (const n of this.npcs) {
      if (['civ', 'ped'].includes(n.kind) && (n.state === 'calm')) { n.state = 'panic'; n.timer = rnd(0.5, 2); }
    }
  }

  // ---------- akcje graczy ----------
  mask(p) {
    if (p.masked) return;
    p.masked = true;
    this.ev(`${p.nick} zakłada maskę`, 'info');
  }

  shout(p, yaw) {
    if (!p.masked) return this.personal(p, 'Najpierw załóż maskę (przytrzymaj G).');
    if (this.t - (p.lastShout || -9) < 0.8) return;
    p.lastShout = this.t;
    const R = p.role === 'iluzjonista' ? 11 : 8;
    this.send({ t: 'shout', id: p.id });
    for (const n of this.npcs) {
      if (n.state === 'tied' || n.state === 'escaped') continue;
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      if (d > R) continue;
      if (d > 3 && angDiff(Math.atan2(dx, dz), yaw) > 1.25) continue;
      if (!lineOfSight(this.map, p.x, p.z, n.x, n.z)) continue;
      if (n.kind === 'guard') {
        if (n.state === 'surrender') { n.timer = 30; continue; }
        if (this.t - n.shoutT > 4) n.shouts = 0;
        n.shoutT = this.t;
        n.shouts += p.role === 'iluzjonista' ? 2 : 1;
        if (n.state === 'calm') { n.state = 'alert'; n.timer = 3.5; n.susp = 1; }
        if (n.shouts >= 2) { n.state = 'surrender'; n.timer = 30; n.path = null; n.anim = 0; }
      } else {
        n.state = 'down'; n.timer = 40; n.path = null; n.anim = 0;
      }
    }
  }

  personal(p, text) { p.conn.send({ t: 'ev', text, kind: 'info' }); }

  setAct(p, id) { p.act = id ? { id, prog: 0 } : null; }

  throwBag(p, yaw) {
    if (!p.carry) return;
    p.carry = false;
    const dist = p.role === 'miesniak' ? 5.5 : 3.6;
    let x = p.x, z = p.z;
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    for (let t = 0; t < dist; t += 0.1) {
      const nx = p.x + sx * t, nz = p.z + sz * t;
      if (blockedAt(this.map, Math.floor(nx), Math.floor(nz))) break;
      x = nx; z = nz;
    }
    if (this.zone.has(key(Math.floor(x), Math.floor(z)))) { this.secureBag(p); return; }
    this.bags.push({ id: 'bag' + this.nextBag++, x, z });
  }

  secureBag(p) {
    this.secured++;
    this.ev(`Worek w furgonetce! (${this.secured})`, 'good');
  }

  // Czas interakcji (s) albo null, gdy niedostępna.
  actDuration(p, it) {
    const kas = p.role === 'kasiarz';
    switch (it.kind) {
      case 'register': return it.done ? null : 2.5;
      case 'keycard': return this.keycard === 'desk' ? 2 : null;
      case 'cameras': return this.looped ? null : (p.role === 'haker' ? 3 : 8);
      case 'door': return it.done ? null : (this.keycard === p.id ? 1 : (kas ? 5 : 10));
      case 'vault':
        if (this.vault === 'open') return null;
        if (this.vault === 'drilling') return this.drill.jam ? (kas ? 1.5 : 3.5) : null;
        return this.keycard === p.id ? 3 : 3;
      case 'cash': return it.done || p.carry ? null : 4;
      case 'bag': return p.carry ? null : 0.4;
      case 'tie': return p.ties > 0 ? 1.5 : null;
    }
    return null;
  }

  findItem(id) {
    if (this.items.has(id)) return this.items.get(id);
    const b = this.bags.find((b) => b.id === id);
    if (b) return { id, kind: 'bag', x: b.x, z: b.z };
    const n = this.npcs.find((n) => 'npc' + n.id === id);
    if (n && (n.state === 'down' || n.state === 'surrender')) return { id, kind: 'tie', x: n.x, z: n.z, npc: n };
    return null;
  }

  completeAct(p, it) {
    switch (it.kind) {
      case 'register': it.done = true; this.loose += this.def.registerValue; this.ev(`${p.nick} opróżnia kasę (+$${this.def.registerValue})`, 'good'); break;
      case 'keycard': this.keycard = p.id; this.ev(`${p.nick} ma kartę kierownika`, 'good'); break;
      case 'cameras': this.looped = true; this.ev('Kamery zapętlone – ochrona nic nie widzi', 'good'); break;
      case 'door': it.done = true; this.map.open.add(it.id); this.ev('Drzwi na zaplecze otwarte', 'good'); break;
      case 'vault':
        if (this.vault === 'drilling') { this.drill.jam = false; this.ev('Wiertło naprawione', 'good'); break; }
        if (this.keycard === p.id) { this.openVault(); this.ev('Karta pasuje – skarbiec otwarty po cichu!', 'good'); }
        else { this.vault = 'drilling'; this.ev('Wiertło pracuje… to będzie głośne!', 'bad'); }
        break;
      case 'cash': it.done = true; p.carry = true; this.ev(`${p.nick} pakuje worek pieniędzy`, 'good'); break;
      case 'bag': {
        this.bags = this.bags.filter((b) => b.id !== it.id); p.carry = true;
        if (this.zone.has(key(Math.floor(p.x), Math.floor(p.z)))) { p.carry = false; this.secureBag(p); }
        break;
      }
      case 'tie': it.npc.state = 'tied'; it.npc.anim = 0; p.ties--; break;
    }
  }

  openVault() { this.vault = 'open'; const v = [...this.items.values()].find((i) => i.kind === 'vault'); this.map.open.add(v.id); v.done = true; }

  // ---------- wzrok ----------
  canSee(n, p, range, fov) {
    const dx = p.x - n.x, dz = p.z - n.z, d = Math.hypot(dx, dz);
    if (d > range) return 0;
    if (d > 2.2 && angDiff(Math.atan2(dx, dz), n.rot) > fov) return 0;
    if (!lineOfSight(this.map, n.x, n.z, p.x, p.z)) return 0;
    return d;
  }

  isSuspicious(p) {
    if (p.masked || p.carry) return 1;
    if (RESTRICTED.has(this.map.at(Math.floor(p.x), Math.floor(p.z)))) return 0.35;
    return 0;
  }

  // ---------- AI ----------
  walkPath(n, speed, dt) {
    if (!n.path || !n.path.length) { n.anim = 0; return true; }
    const [tx, tz] = n.path[0];
    if (moveToward(this.map, n, tx, tz, speed, dt)) n.path.shift();
    n.anim = speed > 3 ? 2 : 1;
    return !n.path.length;
  }

  goTo(n, x, z, opts) {
    n.path = findPath(this.map, n.x, n.z, x, z, opts);
    if (n.path) n.path.shift();
  }

  faceNearestThreat(n) {
    let best = null, bd = 1e9;
    for (const p of this.players()) { if (!p.masked) continue; const d = Math.hypot(p.x - n.x, p.z - n.z); if (d < bd) { bd = d; best = p; } }
    if (best) n.rot = Math.atan2(best.x - n.x, best.z - n.z);
    return best;
  }

  updateGuard(n, dt, look) {
    const ps = this.players();
    if (n.state === 'tied') return;
    if (n.state === 'surrender') {
      n.timer -= dt;
      if (n.timer <= 0) { n.state = 'alert'; n.timer = 3.5; n.shouts = 0; this.ev('Strażnik się otrząsnął – sięga po radio!', 'bad'); }
      return;
    }
    if (n.state === 'alert' || n.state === 'calling') {
      n.anim = 0; this.faceNearestThreat(n);
      if (this.alarm) return;
      n.timer -= dt;
      if (n.state === 'alert' && n.timer <= 1.8) n.state = 'calling';
      if (n.timer <= 0) this.raiseAlarm('Strażnik wezwał policję przez radio');
      return;
    }
    // spokojny: patrol + obserwacja
    if (look) {
      for (const p of ps) {
        const s = this.isSuspicious(p);
        if (!s) continue;
        const d = this.canSee(n, p, 13, 0.95);
        if (!d) continue;
        // na sekundę: blisko ~1.6 s do wykrycia, daleko ~4 s
        const rate = d < 4 ? 0.65 : d < 8 ? 0.4 : 0.25;
        n.susp += s * rate * this.diff.detect * 0.2;
        n.lastSeen = p;
      }
      for (const o of this.npcs) {
        if (o === n || !['down', 'tied', 'surrender'].includes(o.state)) continue;
        if (this.canSee(n, o, 11, 0.95)) { n.susp += 0.35; n.lastSeen = o; }
      }
      if (n.susp >= 1) {
        const ls = n.lastSeen;
        if (ls && ls.conn && !ls.masked && !ls.carry && this.t - (n.warnedAt ?? -99) > 25) {
          n.warnedAt = this.t; n.susp = 0.3;
          this.personal(ls, 'Strażnik: „Proszę natychmiast opuścić strefę dla personelu!” (następnym razem wezwie policję)');
          return;
        }
        n.state = 'alert'; n.timer = 3.5; n.susp = 1; n.path = null;
        this.ev(n.security ? 'Ochrona coś zauważyła!' : 'Strażnik was zauważył!', 'bad');
        return;
      }
    }
    n.susp = Math.max(0, n.susp - 0.12 * dt);
    if (n.susp > 0.3 && n.lastSeen) { n.anim = 0; n.rot = Math.atan2(n.lastSeen.x - n.x, n.lastSeen.z - n.z); return; }
    if (n.post) { n.anim = 0; if (n.security) n.rot = Math.PI; return; }
    if (n.wait > 0) { n.wait -= dt; n.anim = 0; return; }
    if (!n.path || !n.path.length) {
      n.ri = (n.ri + 1) % n.route.length;
      const [x, z] = n.route[n.ri];
      this.goTo(n, x + 0.5, z + 0.5, { passDoors: true });
      if (!n.path) { n.wait = 1; return; }
      n.wait = rnd(1, 3);
      return;
    }
    this.walkPath(n, 1.5, dt);
  }

  updateCivilian(n, dt, look) {
    if (n.state === 'tied' || n.state === 'escaped') return;
    const staff = n.kind === 'teller' || n.kind === 'manager';
    const seesMasked = () => this.players().some((p) => (p.masked) && this.canSee(n, p, 13, 1.2));
    if (n.state === 'down') {
      n.timer -= dt;
      if (n.timer <= 0) { n.state = 'panic'; n.timer = 2.5; this.ev('Ktoś z zakładników próbuje wstać!', 'bad'); }
      return;
    }
    if (n.state === 'panic') {
      n.anim = 0; this.faceNearestThreat(n);
      n.timer -= dt;
      if (n.timer <= 0) {
        if (staff) { n.state = 'calling'; n.timer = staff && n.kind === 'teller' ? 1.5 : 3; }
        else { n.state = 'flee'; const ex = this.nearestExit(n); this.goTo(n, ex[0], ex[1], {}); if (!n.path) n.state = 'panic', n.timer = 2; }
      }
      return;
    }
    if (n.state === 'calling') {
      n.anim = 0; n.timer -= dt;
      if (n.timer <= 0) this.raiseAlarm(n.kind === 'teller' ? 'Kasjer nacisnął cichy alarm' : 'Kierownik zadzwonił na policję');
      return;
    }
    if (n.state === 'flee') {
      if (this.walkPath(n, 4.2, dt)) {
        n.state = 'escaped';
        this.raiseAlarm('Świadek uciekł i wezwał policję');
      }
      return;
    }
    // spokojny
    if (look && (seesMasked() || this.npcs.some((o) => o !== n && ['down', 'tied'].includes(o.state) && this.canSee(n, o, 9, 1.2)))) {
      n.state = 'panic'; n.timer = staff ? 2.5 : rnd(1.6, 2.6); n.path = null;
      return;
    }
    if (staff) { n.anim = 0; return; }
    if (n.wait > 0) { n.wait -= dt; n.anim = 0; return; }
    if (!n.path || !n.path.length) {
      if (n.kind === 'ped') {
        const [x, z] = pick(this.sidewalk); this.goTo(n, x, z, { allowed: (ch) => ch === '-' || ch === 'S' });
      } else {
        const [x, z] = pick(this.lobbyTiles); this.goTo(n, x, z, { allowed: (ch) => ch === '.' });
      }
      n.wait = rnd(2, 7);
      if (!n.path) return;
    }
    this.walkPath(n, n.kind === 'ped' ? 1.4 : 1.1, dt);
  }

  nearestExit(n) {
    let best = this.exits[0], bd = 1e9;
    for (const e of this.exits) { const d = Math.hypot(e[0] - n.x, e[1] - n.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  updateCameras(dt) {
    if (this.looped || this.alarm) return;
    const sg = this.securityGuard;
    if (!sg || !['calm'].includes(sg.state)) return; // nikt nie patrzy w monitory
    let seen = false, onlyUnmasked = true;
    for (const c of this.def.cameras) {
      for (const p of this.players()) {
        const s = this.isSuspicious(p); if (!s) continue;
        if (p.masked || p.carry) onlyUnmasked = false;
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
        if (d > c.range || angDiff(Math.atan2(dx, dz), c.dir) > 0.75) continue;
        if (!lineOfSight(this.map, c.x, c.z, p.x, p.z)) continue;
        seen = true; sg.susp += s * dt * 0.9 * this.diff.detect;
      }
    }
    if (seen && sg.susp >= 1 && onlyUnmasked && this.t - (this.camWarnedAt ?? -99) > 25) {
      this.camWarnedAt = this.t; sg.susp = 0.3;
      this.ev('Głośnik: „Osoby postronne proszone są o opuszczenie zaplecza.” Ochrona was obserwuje!', 'bad');
      return;
    }
    if (seen && sg.susp >= 1) {
      sg.state = 'alert'; sg.timer = 4; sg.susp = 1;
      this.ev('Ochrona zobaczyła was na kamerach! Pokój ochrony – szybko!', 'bad');
    }
  }

  // ---------- pętla ----------
  tick(dt = TICK_DT) {
    if (this.ended) return;
    this.t += dt; this.tickN++;
    const look = this.tickN % 4 === 0;
    const ps = this.players();

    // interakcje
    for (const p of ps) {
      if (!p.act) continue;
      const it = this.findItem(p.act.id);
      const dur = it && this.actDuration(p, it);
      if (!it || !dur || Math.hypot(it.x - p.x, it.z - p.z) > 1.9) { p.act = null; continue; }
      p.act.prog += dt / dur;
      if (p.act.prog >= 1) { this.completeAct(p, it); p.act = null; }
    }
    // worki do furgonetki
    for (const p of ps) if (p.carry && this.zone.has(key(Math.floor(p.x), Math.floor(p.z)))) { p.carry = false; this.secureBag(p); }

    // wiertło
    if (this.vault === 'drilling' && !this.drill.jam) {
      this.drill.prog += dt / 70;
      if (this.drill.jams.length && this.drill.prog >= this.drill.jams[0]) {
        this.drill.jams.shift(); this.drill.jam = true; this.ev('Wiertło się zacięło! Napraw je (E)', 'bad');
      }
      if (this.drill.prog >= 1) { this.openVault(); this.ev('Skarbiec otwarty! Pakujcie pieniądze', 'good'); }
      // hałas wiertła alarmuje strażników w pobliżu
      if (!this.alarm && look) for (const n of this.npcs) if (n.kind === 'guard' && n.state === 'calm' && Math.hypot(n.x - 27.5, n.z - 4.5) < 16) { n.state = 'alert'; n.timer = 3.5; this.ev('Strażnik usłyszał wiertło!', 'bad'); }
    }

    // bieganie w masce jest głośne
    if (look && !this.alarm) for (const p of ps) if (p.masked && p.state === 2) {
      for (const n of this.npcs) if (n.kind === 'guard' && n.state === 'calm' && Math.hypot(n.x - p.x, n.z - p.z) < 6) { n.susp += 0.5; n.lastSeen = p; }
    }

    for (const n of this.npcs) n.kind === 'guard' ? this.updateGuard(n, dt, look) : this.updateCivilian(n, dt, look);
    if (look) this.updateCameras(dt * 4);

    // policja
    if (this.alarm) {
      this.policeT -= dt;
      if (this.policeT <= 0) { this.finish(false, 'Policja otoczyła bank'); return; }
    }

    // ucieczka: wszyscy w strefie furgonetki
    const allIn = ps.length && ps.every((p) => this.zone.has(key(Math.floor(p.x), Math.floor(p.z))));
    const anyLoot = this.secured > 0 || this.loose > 0;
    if (allIn && anyLoot && !ps.some((p) => p.carry)) {
      this.escapeT += dt;
      if (this.escapeT >= 3) { this.finish(true, this.alarm ? 'Uciekliście przed policją' : 'Czysta robota – nikt niczego nie zauważył'); return; }
    } else this.escapeT = 0;

    if (this.tickN % 5 === 0) this.sendState();
  }

  sendState() {
    this.send({
      t: 'hs', alarm: this.alarm, reason: this.alarmReason, policeT: Math.max(0, Math.ceil(this.policeT)),
      doors: [...this.map.open], vault: this.vault, drill: { prog: +this.drill.prog.toFixed(3), jam: this.drill.jam },
      looped: this.looped, keycard: this.keycard,
      done: [...this.items.values()].filter((i) => i.done).map((i) => i.id),
      bags: this.bags.map((b) => [b.id, +b.x.toFixed(2), +b.z.toFixed(2)]),
      secured: this.secured, loose: this.loose, cashTotal: this.cashTotal, escapeT: +this.escapeT.toFixed(2),
      cams: this.camerasActive(),
    });
  }

  camerasActive() {
    const sg = this.securityGuard;
    return !this.looped && sg && !['tied', 'surrender'].includes(sg.state);
  }

  npcSnapshot() {
    return this.npcs.filter((n) => n.state !== 'escaped').map((n) => [n.id, +n.x.toFixed(2), +n.z.toFixed(2), +n.rot.toFixed(2), n.anim, ST[n.state], +Math.min(1, n.susp).toFixed(2)]);
  }

  npcInfo() { return this.npcs.map((n) => ({ id: n.id, kind: n.kind, color: n.color })); }

  finish(success, reason) {
    if (this.ended) return;
    this.ended = true;
    const ps = this.players();
    const stealth = success && !this.alarm;
    const base = this.secured * this.def.bagValue + this.loose;
    const total = Math.round(base * this.diff.payout * (stealth ? 1.5 : 1) * (success ? 1 : 0.5));
    const cut = ps.length ? Math.floor(total / ps.length) : 0;
    this.result = { success, reason, secured: this.secured, loose: this.loose, mult: this.diff.payout, stealth, total, cut };
  }
}
