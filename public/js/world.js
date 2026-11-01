// Buduje scenę 3D z mapy: podłogi, ściany, ulica, meble, obiekty napadu, światło dzienne.
import * as THREE from 'three';

const WALLS = new Set(['#', 'W', 'H']);           // rysowane jako bryły ścian
const DOORS = new Set(['L', 'V']);                // ściany-drzwi (osobne obiekty)
const FLOOR_OF = {
  '.': 'marble', r: 'marble', h: 'marble', g: 'marble', C: 'marble', R: 'marble', O: 'marble', b: 'marble', p: 'marble',
  _: 'carpet', K: 'carpet', D: 'carpet', ':': 'lino', d: 'lino', M: 'lino', L: 'lino', V: 'steel', v: 'steel', $: 'steel',
  ',': 'asphalt', Z: 'asphalt', Y: 'asphalt', P: 'asphalt', '-': 'sidewalk', S: 'sidewalk', l: 'sidewalk', X: 'sidewalk',
};

// ---------- tekstury proceduralne ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function noise(g, s, base, amp, count, size) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < count; i++) {
    const v = (Math.random() - 0.5) * amp;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    const r = Math.random() * size + 1;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}
const TEX = {
  carpet: () => canvasTex(256, (g, s) => { noise(g, s, '#5a1c20', 0.12, 9000, 2); g.strokeStyle = 'rgba(201,164,92,0.3)'; g.lineWidth = 3; g.strokeRect(10, 10, s - 20, s - 20); }),
  lino: () => canvasTex(256, (g, s) => { noise(g, s, '#8d8a82', 0.08, 5000, 2); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; g.strokeRect(0, 0, s / 2, s / 2); g.strokeRect(s / 2, s / 2, s / 2, s / 2); }),
  steel: () => canvasTex(256, (g, s) => {
    noise(g, s, '#6b7076', 0.1, 4000, 2); g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 16; y < s; y += 32) for (let x = 16; x < s; x += 32) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
  }),
  asphalt: () => canvasTex(512, (g, s) => noise(g, s, '#3b3d40', 0.16, 30000, 2)),
  sidewalk: () => canvasTex(256, (g, s) => { noise(g, s, '#a7a39a', 0.1, 6000, 2); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s); }),
  wood: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#3a1f12'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      g.strokeStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '120,70,40'},${Math.random() * 0.25})`;
      g.lineWidth = Math.random() * 2 + 0.5; g.beginPath(); const y = Math.random() * s; g.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x / 40 + i) * 3);
      g.stroke();
    }
  }),
  plaster: () => canvasTex(256, (g, s) => noise(g, s, '#d8cdb6', 0.07, 7000, 3)),
  brick: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#6e4a3c'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < s; x += 32) {
      const v = 0.85 + Math.random() * 0.3; g.fillStyle = `rgb(${130 * v | 0},${78 * v | 0},${60 * v | 0})`; g.fillRect(x + 1, y + 1, 30, 14);
    }
  }),
  facade: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#8b8172'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#2a3442'; g.fillRect(40, 60, 70, 110); g.fillRect(146, 60, 70, 110);
    g.fillStyle = 'rgba(160,190,220,0.35)'; g.fillRect(44, 64, 30, 50); g.fillRect(150, 64, 30, 50);
    g.fillStyle = '#6e665a'; g.fillRect(0, 200, s, 10);
  }),
};

export function buildWorld(scene, map, marbleTex, opts = {}) {
  const tps = !!opts.allTall;
  const group = new THREE.Group();
  scene.add(group);
  const fadeables = [];
  const dyn = { cash: new Map(), registers: new Map(), doors: new Map(), vault: null, drill: null, keycard: null, camLeds: [], zone: null };

  marbleTex.wrapS = marbleTex.wrapT = THREE.RepeatWrapping;
  marbleTex.colorSpace = THREE.SRGBColorSpace; marbleTex.anisotropy = 8;
  const woodTex = TEX.wood();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    marble: std({ map: marbleTex, roughness: 0.25, metalness: 0.05, color: '#f2e6d4' }),
    carpet: std({ map: TEX.carpet(), roughness: 0.95 }),
    lino: std({ map: TEX.lino(), roughness: 0.8 }),
    steel: std({ map: TEX.steel(), roughness: 0.55, metalness: 0.5, color: '#9aa0a6' }),
    asphalt: std({ map: TEX.asphalt(), roughness: 0.95 }),
    sidewalk: std({ map: TEX.sidewalk(), roughness: 0.9 }),
    wood: std({ map: woodTex, roughness: 0.55, color: '#c08a68' }),
    woodDark: std({ map: woodTex, roughness: 0.6, color: '#8a5a40' }),
    plaster: std({ map: TEX.plaster(), roughness: 0.9 }),
    brick: std({ map: TEX.brick(), roughness: 0.9 }),
    facade: std({ map: TEX.facade(), roughness: 0.85 }),
    cap: std({ color: '#3a2c22', roughness: 0.8 }),
    brass: std({ color: '#c9a04a', roughness: 0.3, metalness: 1.0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }),
    window: new THREE.MeshPhysicalMaterial({ color: '#a9c6dc', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
    frame: std({ color: '#2b2a28', roughness: 0.5, metalness: 0.5 }),
    lampShade: std({ color: '#1f6b3a', roughness: 0.35, emissive: '#2f8a4c', emissiveIntensity: 0.25 }),
    pillar: std({ map: marbleTex, color: '#fff6ea', roughness: 0.3 }),
    leaf: std({ color: '#3d6a33', roughness: 0.8 }),
    pot: std({ color: '#8a6a45', roughness: 0.6 }),
    vault: std({ color: '#9aa1a8', roughness: 0.3, metalness: 0.9 }),
    door: std({ map: woodTex, color: '#7a4a34', roughness: 0.5 }),
    screen: std({ color: '#0c1a14', emissive: '#2f9a68', emissiveIntensity: 0.8 }),
    paper: std({ color: '#ece6d6', roughness: 0.9 }),
    cash: std({ color: '#7f9a6a', roughness: 0.7 }),
    band: std({ color: '#d8c890', roughness: 0.6 }),
    van: std({ color: '#e8e8e6', roughness: 0.4, metalness: 0.3 }),
    tire: std({ color: '#111', roughness: 0.9 }),
    darkGlass: std({ color: '#1a2633', roughness: 0.1, metalness: 0.6 }),
    zone: new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.22, depthWrite: false }),
    paint: std({ color: '#e8e2c8', roughness: 0.8 }),
    panel: new THREE.MeshBasicMaterial({ color: '#fff4dc' }),
    led: new THREE.MeshBasicMaterial({ color: '#ff2a2a' }),
    ledOff: new THREE.MeshBasicMaterial({ color: '#331010' }),
    camBody: std({ color: '#e5e5e5', roughness: 0.5 }),
    barrier: std({ color: '#c8c2b4', roughness: 0.8 }),
  };
  const carColors = ['#3a4a6a', '#7a2a2a', '#2f5a3a', '#bbbbb5'];

  // ---------- podłogi ----------
  const floorBuckets = {};
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    const ch = map.at(x, z);
    if (WALLS.has(ch)) continue;
    const m = FLOOR_OF[ch] || 'marble';
    (floorBuckets[m] ||= []).push([x, z]);
  }
  for (const [m, tiles] of Object.entries(floorBuckets)) {
    const pos = [], uv = [], idx = [];
    const s = m === 'asphalt' ? 0.25 : 0.5;
    tiles.forEach(([x, z], i) => {
      pos.push(x, 0, z, x + 1, 0, z, x + 1, 0, z + 1, x, 0, z + 1);
      uv.push(x * s, z * s, (x + 1) * s, z * s, (x + 1) * s, (z + 1) * s, x * s, (z + 1) * s);
      const b = i * 4; idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, M[m]); mesh.receiveShadow = true; group.add(mesh);
  }
  // linie na jezdni
  const dash = new THREE.PlaneGeometry(1.2, 0.12);
  for (let x = 1.5; x < map.w - 1; x += 3) {
    if (map.at(Math.floor(x), 26) !== ',') continue;
    const d = new THREE.Mesh(dash, M.paint); d.rotation.x = -Math.PI / 2; d.position.set(x, 0.01, 26.5); d.receiveShadow = true; group.add(d);
  }

  // ---------- ściany ----------
  const isOpenFloor = (x, z) => x >= 0 && z >= 0 && x < map.w && z < map.h && !WALLS.has(map.at(x, z)) && !DOORS.has(map.at(x, z));
  const inRoof = (x, z) => map.roof && x >= map.roof[0] && x <= map.roof[2] && z >= map.roof[1] && z <= map.roof[3];
  const H_TALL = 3.0, H_SHORT = 0.55, WAINSCOT = 1.0;
  const parts = { wood: [], plaster: [], cap: [], window: [], frame: [], brick: [], facade: [], shortCap: [] };
  const box = (list, x, y, z, sx, sy, sz) => list.push([x, y, z, sx, sy, sz]);
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    const ch = map.at(x, z);
    if (!WALLS.has(ch)) continue;
    const behind = isOpenFloor(x - 1, z) || isOpenFloor(x, z - 1) || isOpenFloor(x - 1, z - 1);
    const front = isOpenFloor(x + 1, z) || isOpenFloor(x, z + 1) || isOpenFloor(x + 1, z + 1);
    if (!behind && !front) continue; // niewidoczny środek bryły
    const short = tps ? false : (behind || !front);
    const cx = x + 0.5, cz = z + 0.5;
    if (ch === 'H') {
      const hgt = short ? H_SHORT : 7;
      box(z >= 30 || z <= 0 ? parts.facade : parts.brick, cx, hgt / 2, cz, 1, hgt, 1);
      continue;
    }
    if (short) { box(parts.wood, cx, H_SHORT / 2, cz, 1, H_SHORT, 1); box(parts.shortCap, cx, H_SHORT + 0.02, cz, 1, 0.04, 1); continue; }
    if (ch === 'W') {
      box(parts.wood, cx, 0.45, cz, 1, 0.9, 1);
      box(parts.window, cx, 1.85, cz, 0.98, 1.9, 0.12);
      box(parts.frame, cx, 2.85, cz, 1, 0.3, 1);
      box(parts.frame, cx, 0.92, cz, 1, 0.05, 0.4);
      continue;
    }
    const inside = inRoof(x, z);
    box(parts.wood, cx, WAINSCOT / 2, cz, 1, WAINSCOT, 1);
    box(inside ? parts.plaster : parts.brick, cx, WAINSCOT + (H_TALL - WAINSCOT) / 2, cz, 1, H_TALL - WAINSCOT, 1);
    // budynek banku z zewnątrz wyższy (gzyms)
    if (inside && (isOpenFloor(x, z + 1) && !inRoof(x, z + 1))) box(parts.brick, cx, 3.6, cz, 1, 1.2, 1);
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  function instance(list, mat, cast = true) {
    if (!list || !list.length) return;
    const im = new THREE.InstancedMesh(unit, mat, list.length);
    list.forEach(([x, y, z, sx, sy, sz], i) => { dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.castShadow = cast; im.receiveShadow = true; group.add(im);
  }

  // ---------- meble i obiekty ----------
  const props = { wood: [], woodDark: [], marbleTop: [], brass: [], glass: [], cap: [], barrier: [] };
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 20);
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, cast = true, parent = group) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
  };
  function bankerLamp(x, y, z) {
    add(cyl, M.brass, x, y + 0.01, z, 0.07, 0.02, 0.07);
    add(cyl, M.brass, x, y + 0.15, z, 0.012, 0.3, 0.012);
    const shade = add(new THREE.CylinderGeometry(0.05, 0.13, 0.08, 16, 1, true), M.lampShade, x, y + 0.32, z);
    shade.material.side = THREE.DoubleSide;
  }
  function desk(cx, cz) {
    box(props.wood, cx, 0.37, cz, 0.95, 0.74, 0.7);
    box(props.woodDark, cx, 0.77, cz, 1.0, 0.05, 0.76);
  }
  const seen = new Set();
  const rectOf = (x0, z0, ch) => { let x1 = x0, z1 = z0; while (map.at(x1 + 1, z0) === ch) x1++; while (map.at(x0, z1 + 1) === ch) z1++; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) seen.add(x + ',' + z); return [x0, z0, x1, z1]; };

  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    const ch = map.at(x, z), cx = x + 0.5, cz = z + 0.5, k = x + ',' + z;
    if (seen.has(k)) continue;
    if (ch === 'C' || ch === 'R') {
      box(props.wood, cx, 0.5, cz, 1.0, 1.0, 0.8);
      box(props.marbleTop, cx, 1.03, cz, 1.0, 0.06, 0.92);
      box(props.glass, cx, 1.36, cz + 0.4, 1.0, 0.6, 0.02);
      box(props.brass, cx, 1.66, cz + 0.4, 1.0, 0.025, 0.03);
      if (x % 2 === 0) add(cyl, M.brass, x, 1.36, cz + 0.4, 0.03, 0.62, 0.03);
      if (ch === 'R') {
        const g = new THREE.Group(); g.position.set(cx, 1.06, cz - 0.1); group.add(g);
        add(unit, M.cap, 0, 0.08, 0, 0.42, 0.16, 0.34, true, g);
        add(unit, M.screen, 0, 0.26, -0.05, 0.28, 0.18, 0.03, false, g);
        const drawer = add(unit, M.cash, 0, 0.17, 0.15, 0.36, 0.03, 0.2, false, g);
        dyn.registers.set(k, drawer);
      } else if (x % 5 === 2) bankerLamp(cx, 1.06, cz - 0.2);
    } else if (ch === 'D' || ch === 'K') {
      desk(cx, cz); bankerLamp(cx - 0.3, 0.8, cz - 0.15);
      add(unit, M.paper, cx + 0.15, 0.805, cz + 0.05, 0.3, 0.01, 0.22, false);
      if (ch === 'K') {
        const card = add(unit, new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#4aa3ff', emissiveIntensity: 0.8 }), cx + 0.1, 0.81, cz - 0.15, 0.09, 0.01, 0.055, false);
        dyn.keycard = card;
      }
    } else if (ch === 'M') {
      desk(cx, cz);
      for (const dx of [-0.25, 0.25]) { add(unit, M.cap, cx + dx, 1.0, cz - 0.15, 0.4, 0.3, 0.04); add(unit, M.screen, cx + dx, 1.0, cz - 0.125, 0.36, 0.26, 0.01, false); }
    } else if (ch === '$') {
      const g = new THREE.Group(); g.position.set(cx, 0, cz); group.add(g);
      add(unit, M.woodDark, 0, 0.06, 0, 0.9, 0.12, 0.7, true, g);
      for (let i = 0; i < 12; i++) {
        const sx = (i % 3 - 1) * 0.26, sz = (Math.floor(i / 3) % 2 - 0.5) * 0.3, sy = 0.17 + Math.floor(i / 6) * 0.11;
        add(unit, M.cash, sx, sy, sz, 0.24, 0.1, 0.13, true, g);
        add(unit, M.band, sx, sy, sz, 0.05, 0.105, 0.135, false, g);
      }
      dyn.cash.set(k, g);
    } else if (ch === 'O') {
      const pillar = new THREE.Group();
      const mat = M.pillar.clone(); mat.transparent = true;
      const capMat = M.cap.clone(); capMat.transparent = true;
      const base = new THREE.Mesh(unit, capMat); base.scale.set(0.9, 0.3, 0.9); base.position.y = 0.15;
      const shaft = new THREE.Mesh(cyl, mat); shaft.scale.set(0.34, 2.6, 0.34); shaft.position.y = 1.6;
      const top = new THREE.Mesh(unit, capMat); top.scale.set(0.86, 0.2, 0.86); top.position.y = 2.9;
      for (const m of [base, shaft, top]) { m.castShadow = true; m.receiveShadow = true; pillar.add(m); }
      pillar.position.set(cx, 0, cz); group.add(pillar);
      fadeables.push({ obj: pillar, x: cx, z: cz, mats: [mat, capMat], opacity: 1 });
    } else if (ch === 'b') {
      box(props.woodDark, cx, 0.42, cz, 1.0, 0.07, 0.45); box(props.woodDark, cx, 0.2, cz, 0.9, 0.4, 0.08);
    } else if (ch === 'p') {
      add(cyl, M.pot, cx, 0.25, cz, 0.22, 0.5, 0.22);
      const leaves = new THREE.IcosahedronGeometry(1, 0);
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; add(leaves, M.leaf, cx + Math.cos(a) * 0.18, 0.75 + (i % 3) * 0.18, cz + Math.sin(a) * 0.18, 0.22, 0.28, 0.22); }
    } else if (ch === 'l') {
      add(cyl, M.frame, cx, 2.2, cz, 0.06, 4.4, 0.06);
      add(unit, M.frame, cx, 4.35, cz + 0.4, 0.12, 0.08, 0.9);
      add(unit, M.panel, cx, 4.3, cz + 0.75, 0.25, 0.04, 0.3, false);
    } else if (ch === 'X') {
      box(props.barrier, cx, 0.4, cz, 0.5, 0.8, 1.0);
    } else if (ch === 'g') {
      add(unit, M.glass, cx, 1.2, cz, 0.95, 2.3, 0.05, false);
      add(unit, M.frame, cx, 2.45, cz, 1, 0.2, 0.2);
    } else if (ch === 'L') {
      const pivot = new THREE.Group(); pivot.position.set(x, 0, cz); group.add(pivot);
      add(unit, M.door, 0.5, 1.05, 0, 0.96, 2.1, 0.08, true, pivot);
      add(unit, M.brass, 0.85, 1.0, 0.07, 0.04, 0.12, 0.04, false, pivot);
      add(unit, M.frame, cx - x, 2.55, 0, 1, 0.9, 0.3, true, group).position.set(cx, 2.55, cz);
      add(unit, new THREE.MeshBasicMaterial({ color: '#ff3030' }), 0.85, 1.25, 0.08, 0.06, 0.08, 0.02, false, pivot);
      dyn.doors.set(k, pivot);
    } else if (ch === 'V') {
      const g = new THREE.Group(); g.position.set(cx, 0, cz); group.add(g);
      add(unit, M.steel, -0.48, 1.5, 0, 0.06, 3.0, 1.0, true, g);
      add(unit, M.steel, 0.48, 1.5, 0, 0.06, 3.0, 1.0, true, g);
      add(unit, M.steel, 0, 2.75, 0, 1, 0.5, 1.0, true, g);
      const pivot = new THREE.Group(); pivot.position.set(-0.47, 0, 0.3); g.add(pivot);
      add(unit, M.vault, 0.47, 1.2, 0, 0.94, 2.4, 0.3, true, pivot);
      for (const yy of [0.5, 1.2, 1.9]) add(cyl, M.steel, 0.9, yy, 0, 0.05, 0.12, 0.05, false, pivot).rotation.x = Math.PI / 2;
      const ring = add(new THREE.TorusGeometry(0.3, 0.03, 8, 32), M.steel, 0.47, 1.25, 0.16, 1, 1, 1, false, pivot);
      const wheel = add(new THREE.TorusGeometry(0.22, 0.03, 8, 24), M.brass, 0.47, 1.25, 0.2, 1, 1, 1, false, pivot);
      for (let i = 0; i < 3; i++) { const sp = add(unit, M.brass, 0.47, 1.25, 0.2, 0.42, 0.025, 0.025, false, pivot); sp.rotation.z = i * Math.PI / 3; }
      const drill = new THREE.Group(); drill.position.set(0, 1.25, 0.55); drill.visible = false; g.add(drill);
      add(unit, std({ color: '#d84b20', roughness: 0.5 }), 0, 0, 0, 0.35, 0.35, 0.55, true, drill);
      add(cyl, M.steel, 0, 0, -0.35, 0.05, 0.3, 0.05, true, drill).rotation.x = Math.PI / 2;
      add(unit, M.frame, 0, -0.55, 0.1, 0.06, 0.9, 0.06, true, drill);
      dyn.vault = pivot; dyn.drill = drill; dyn.wheel = wheel;
    } else if (ch === 'Y') {
      const [x0, z0, x1, z1] = rectOf(x, z, 'Y');
      const len = x1 - x0 + 1, wid = z1 - z0 + 1;
      const g = new THREE.Group(); g.position.set((x0 + x1 + 1) / 2, 0, (z0 + z1 + 1) / 2); group.add(g);
      add(unit, M.van, -0.2, 1.35, 0, len - 0.4, 1.9, wid - 0.15, true, g);
      add(unit, M.van, len / 2 - 0.55, 0.95, 0, 0.9, 1.1, wid - 0.2, true, g);
      add(unit, M.darkGlass, len / 2 - 0.35, 1.7, 0, 0.7, 0.6, wid - 0.3, false, g);
      for (const wx of [-len / 2 + 1.1, len / 2 - 1.1]) for (const wz of [-wid / 2 + 0.1, wid / 2 - 0.1]) {
        const w = add(cyl, M.tire, wx, 0.38, wz, 0.38, 0.25, 0.38, true, g); w.rotation.x = Math.PI / 2;
      }
      // otwarte tylne drzwi
      for (const s of [-1, 1]) { const d = add(unit, M.van, -len / 2 - 0.25, 1.35, s * (wid / 2 - 0.05), 0.05, 1.8, wid / 2 - 0.1, true, g); d.rotation.y = s * 1.2; d.position.x -= 0.45; }
      add(unit, std({ color: '#151515' }), -len / 2 + 0.1, 1.35, 0, 0.05, 1.7, wid - 0.4, false, g);
    } else if (ch === 'P') {
      const [x0, z0, x1, z1] = rectOf(x, z, 'P');
      const len = x1 - x0 + 1, wid = z1 - z0 + 1;
      const g = new THREE.Group(); g.position.set((x0 + x1 + 1) / 2, 0, (z0 + z1 + 1) / 2); group.add(g);
      const col = std({ color: carColors[(x0 + z0) % carColors.length], roughness: 0.35, metalness: 0.5 });
      add(unit, col, 0, 0.6, 0, len - 0.2, 0.7, wid - 0.3, true, g);
      add(unit, col, -0.1, 1.15, 0, len * 0.5, 0.5, wid - 0.4, true, g);
      add(unit, M.darkGlass, -0.1, 1.15, 0, len * 0.52, 0.42, wid - 0.38, false, g);
      for (const wx of [-len / 2 + 0.7, len / 2 - 0.7]) for (const wz of [-wid / 2 + 0.2, wid / 2 - 0.2]) { const w = add(cyl, M.tire, wx, 0.32, wz, 0.32, 0.2, 0.32, true, g); w.rotation.x = Math.PI / 2; }
    } else if (ch === 'Z' && !dyn.zone) {
      const [x0, z0, x1, z1] = rectOf(x, z, 'Z');
      const zone = add(new THREE.PlaneGeometry(x1 - x0 + 1, z1 - z0 + 1), M.zone, (x0 + x1 + 1) / 2, 0.02, (z0 + z1 + 1) / 2, 1, 1, 1, false);
      zone.rotation.x = -Math.PI / 2; dyn.zone = zone;
    }
  }
  instance(parts.wood, M.woodDark); instance(parts.plaster, M.plaster); instance(parts.shortCap, M.cap);
  instance(parts.window, M.window, false); instance(parts.frame, M.frame); instance(parts.brick, M.brick); instance(parts.facade, M.facade);
  instance(props.wood, M.wood); instance(props.woodDark, M.woodDark);
  instance(props.marbleTop, std({ map: marbleTex, roughness: 0.15, metalness: 0.1, color: '#d8c8b0' }));
  instance(props.glass, M.glass, false); instance(props.brass, M.brass, false); instance(props.barrier, M.barrier);

  // kamery
  for (const c of map.cameras || []) {
    const g = new THREE.Group(); g.position.set(c.x, 2.7, c.z); g.rotation.y = c.dir; group.add(g);
    add(unit, M.camBody, 0, 0, 0.1, 0.14, 0.12, 0.3, true, g);
    const led = add(new THREE.SphereGeometry(0.025, 8, 6), M.led, 0.05, 0.05, 0.26, 1, 1, 1, false, g);
    dyn.camLeds.push(led);
  }

  // ---------- sufit (widok zza pleców) ----------
  if (tps && map.roof) {
    const [rx0, rz0, rx1, rz1] = map.roof;
    const pos = [], idx = []; let i = 0;
    for (let z = rz0; z <= rz1; z++) for (let x = rx0; x <= rx1; x++) {
      if (WALLS.has(map.at(x, z))) continue;
      pos.push(x, 3.0, z, x + 1, 3.0, z, x + 1, 3.0, z + 1, x, 3.0, z + 1);
      const b = i++ * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const ceil = new THREE.Mesh(g, std({ color: '#e8e2d6', roughness: 0.95, side: THREE.DoubleSide }));
    ceil.castShadow = true; group.add(ceil);
  }

  // ---------- światło ----------
  const day = !!map.daytime;
  const hemi = new THREE.HemisphereLight(day ? '#cfe0f5' : '#2c3550', day ? '#6a5f52' : '#0a0a0e', day ? 1.1 : 0.42);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(day ? '#fff1dc' : '#7f93c8', day ? 2.6 : 0.55);
  sun.position.set(map.w / 2 + 14, 22, map.h / 2 + 18);
  sun.target.position.set(map.w / 2, 0, map.h / 2);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
  sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);
  for (const l of map.lights || []) {
    const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 1.4);
    pl.position.set(l.x, l.y - 0.1, l.z); group.add(pl);
    if (l.kind === 'panel') add(unit, M.panel, l.x, 2.99, l.z, 1.2, 0.02, 0.6, false);
  }

  const dispose = () => { scene.remove(group); group.traverse((o) => o.geometry?.dispose?.()); };
  return { group, fadeables, moon: sun, dyn, materials: M, dispose };
}
