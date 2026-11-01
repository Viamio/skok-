// Rozgrywka: renderowanie, postacie, sterowanie, predykcja ruchu, interakcje, HUD napadu.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildWorld } from '/js/world.js';
import { MAPS } from '/shared/maps.js';
import { parseMap, stepPlayer, ROLES, TICK_DT, key } from '/shared/sim.js';

const CAM_ELEV = THREE.MathUtils.degToRad(38);
const CAM_DIST = 40;
const SHOULDER = 0.45;
const PIVOT_H = 1.55;
const CAM_BLOCK = new Set(['#', 'W', 'V', 'H', 'O', 'L', 'Y', 'g']);
const INTERP_DELAY = 110;
const STANCE_LABEL = ['Chód', 'Chód', 'Bieg – głośno!', 'Skradanie', 'Skradanie'];
const NPC_ST = ['calm', 'panic', 'down', 'tied', 'flee', 'alert', 'calling', 'surrender', 'escaped'];
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + Math.round(n).toLocaleString('pl-PL');

const models = {};
function loadModel(name) { return (models[name] ||= new GLTFLoader().loadAsync(`/assets/${name}.glb`)); }

function textSprite(text, color, size = 30, w = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = 64;
  const g = c.getContext('2d');
  g.font = `700 ${size}px Segoe UI, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(text, w / 2, 32);
  g.fillStyle = color; g.fillText(text, w / 2, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6 * w / 256, 0.4, 1); s.renderOrder = 10;
  return s;
}
const ICONS = {};
function icon(name) {
  const defs = { panic: ['!', '#ffd23f'], alert: ['!', '#ff3b3b'], calling: ['DZWONI!', '#ff3b3b'], down: ['▼', '#9fd3ff'], tied: ['⛓', '#9fb0c0'], surrender: ['✋', '#9fd3ff'], susp: ['?', '#ffd23f'] };
  const [t, c] = defs[name];
  const s = textSprite(t, c, name === 'calling' ? 26 : 40);
  return s;
}

// Szara kopia tekstury – pozwala przemalować ubranie na dowolny kolor z zachowaniem faktury.
const grayCache = new Map();
function grayTexture(tex) {
  if (!tex?.image) return null;
  if (grayCache.has(tex)) return grayCache.get(tex);
  const img = tex.image, w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), a = d.data;
  let sum = 0; for (let i = 0; i < a.length; i += 4) sum += 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];
  const k = 200 / Math.max(20, sum / (a.length / 4));
  for (let i = 0; i < a.length; i += 4) { const l = Math.min(255, (0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]) * k); a[i] = a[i + 1] = a[i + 2] = l; }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  grayCache.set(tex, t);
  return t;
}

// Przenoszenie animacji między szkieletami o różnych pozach spoczynkowych (w przestrzeni świata).
// 1) ustawiamy kości celu w tej samej pozie co źródło (dopasowanie kierunków kości),
// 2) dla każdej klatki: obrót_świata_celu = obrót_świata_źródła · (spocz_źródła)⁻¹ · spocz_celu.
function retargetWorld(srcGltf, tgtGltf, mapName, clipNames, fps = 30) {
  const src = SkeletonUtils.clone(srcGltf.scene), tgt = SkeletonUtils.clone(tgtGltf.scene);
  const bonesOf = (root) => { const out = []; root.traverse((o) => { if (o.isBone) out.push(o); }); return out; };
  const tBones = bonesOf(tgt).filter((b) => src.getObjectByName(mapName(b.name)));
  const sOf = new Map(tBones.map((b) => [b, src.getObjectByName(mapName(b.name))]));
  src.updateMatrixWorld(true); tgt.updateMatrixWorld(true);
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const firstChild = (b) => b.children.find((c) => c.isBone);
  // 1) dopasowanie pozy spoczynkowej celu do źródła
  for (const b of tBones) {
    const c = firstChild(b), sb = sOf.get(b), sc = sb && firstChild(sb);
    if (!c || !sc) continue;
    tgt.updateMatrixWorld(true);
    const dT = wp(c).sub(wp(b)).normalize(), dS = wp(sc).sub(wp(sb)).normalize();
    if (dT.lengthSq() < 0.5 || dS.lengthSq() < 0.5) continue;
    const fix = new THREE.Quaternion().setFromUnitVectors(dT, dS);
    const newWorld = fix.multiply(wq(b));
    const parentW = b.parent ? wq(b.parent) : new THREE.Quaternion();
    b.quaternion.copy(parentW.invert().multiply(newWorld));
  }
  tgt.updateMatrixWorld(true);
  const restS = new Map(), restT = new Map(), parentRestT = new Map();
  for (const b of tBones) { restS.set(b, wq(sOf.get(b))); restT.set(b, wq(b)); parentRestT.set(b, b.parent ? wq(b.parent) : new THREE.Quaternion()); }
  const tSet = new Set(tBones);
  const out = [];
  for (const clipName of clipNames) {
    const clip = srcGltf.animations.find((c) => c.name === clipName);
    if (!clip) continue;
    const mixer = new THREE.AnimationMixer(src);
    const action = mixer.clipAction(clip); action.play();
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n), vals = new Map(tBones.map((b) => [b, new Float32Array(n * 4)]));
    for (let i = 0; i < n; i++) {
      const t = Math.min(clip.duration, i / fps); times[i] = t;
      mixer.setTime(t); src.updateMatrixWorld(true);
      const worldT = new Map();
      for (const b of tBones) { // kolejność traverse = od rodzica do dziecka
        const w = wq(sOf.get(b)).multiply(restS.get(b).clone().invert()).multiply(restT.get(b));
        worldT.set(b, w);
        const pw = tSet.has(b.parent) ? worldT.get(b.parent) : parentRestT.get(b);
        const local = pw.clone().invert().multiply(w);
        local.toArray(vals.get(b), i * 4);
      }
    }
    mixer.stopAllAction();
    out.push(new THREE.AnimationClip(clipName, clip.duration, tBones.map((b) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, vals.get(b)))));
  }
  return out;
}

// Doczepia obiekt (wymiary w metrach) do kości – kompensuje skalę szkieletu Mixamo.
function attach(bone, obj) {
  const s = new THREE.Vector3(); bone.getWorldScale(s);
  const k = 1 / (s.x || 1);
  const wrap = new THREE.Group(); wrap.scale.setScalar(k); wrap.add(obj);
  bone.add(wrap);
  obj.userData.wrap = wrap;
}

// ---------- postać (gracz albo NPC) ----------
class Character {
  constructor(gltf, o) {
    this.id = o.id; this.isNpc = !!o.npc; this.kind = o.kind; this.role = o.role; this.nick = o.nick;
    this.faceOffset = o.faceOffset || 0;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.tilt = new THREE.Group(); this.body.add(this.tilt);
    this.holder = new THREE.Group(); this.holder.rotation.y = this.faceOffset; this.tilt.add(this.holder);
    this.model = SkeletonUtils.clone(gltf.scene);
    const tint = o.tint ? new THREE.Color(o.tint) : null;
    this.model.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      m.material = m.material.clone();
      if (o.hide?.includes(m.name)) { m.visible = false; return; }
      const re = o.recolor?.[m.name];
      if (re) { const gt = grayTexture(m.material.map); if (gt) m.material.map = gt; m.material.color.set(re); return; }
      if (tint && (!o.tintOnly || m.name === o.tintOnly)) m.material.color.copy(tint);
      else if (tint) m.material.color.lerp(tint, 0.25);
    });
    if (o.scale) this.model.scale.multiplyScalar(o.scale);
    this.holder.add(this.model);
    this.model.updateMatrixWorld(true);
    const bone = (n) => this.model.getObjectByName(n);
    this.head = bone('mixamorigHead') || bone('Head'); this.spine = bone('mixamorigSpine2') || bone('Spine2');
    if (o.cap && this.head) {
      const capMat = new THREE.MeshStandardMaterial({ color: '#141c30', roughness: 0.6 });
      const cap = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.11, 0.08, 16), capMat); top.position.y = 0.17;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.09), capMat); brim.position.set(0, 0.14, 0.1);
      cap.add(top, brim); attach(this.head, cap);
    }
    if (o.color) {
      const color = new THREE.Color(o.color);
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.02; this.root.add(this.ring);
      this.label = textSprite(o.nick, o.color); this.label.position.y = 2.15; this.root.add(this.label);
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    const anims = o.clips || gltf.animations;
    const clip = (...names) => anims.find((a) => names.includes(a.name));
    this.actions = {
      idle: this.mixer.clipAction(clip('Idle', 'idle')), walk: this.mixer.clipAction(clip('Walk', 'walk')), run: this.mixer.clipAction(clip('Run', 'run')),
    };
    for (const a of Object.values(this.actions)) { a.play(); a.setEffectiveWeight(0); }
    this.actions.idle.setEffectiveWeight(1); this.actions.idle.time = Math.random() * 2;
    this.current = 'idle'; this.crouch = 1; this.lie = 0;
    this.x = o.x ?? 0; this.z = o.z ?? 0; this.rot = o.rot ?? 0; this.state = 0; this.visRot = this.rot;
    this.buffer = [];
    this.iconKey = null; this.iconSprite = null;
  }
  setMask(on, color) {
    if (on === !!this.mask || !this.head) return;
    if (on) {
      const g = new THREE.Group();
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.4 }));
      face.rotation.x = Math.PI / 2; face.position.z = 0.03;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.02), new THREE.MeshBasicMaterial({ color }));
      stripe.position.set(0, 0.0, 0.13);
      g.add(face, stripe); g.position.set(0, 0.09, 0.05);
      attach(this.head, g); this.mask = g;
    } else { this.head.remove(this.mask); this.mask = null; }
  }
  setCarry(on) {
    if (on === !!this.bag || !this.spine) return;
    if (on) {
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 6, 12), new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.8 }));
      bag.rotation.z = Math.PI / 2; bag.position.set(0, 0.05, -0.24);
      attach(this.spine, bag); this.bag = bag;
    } else { const w = this.bag.userData.wrap; w.parent.remove(w); this.bag = null; }
  }
  setIcon(name) {
    if (name === this.iconKey) return;
    if (this.iconSprite) this.root.remove(this.iconSprite);
    this.iconKey = name; this.iconSprite = null;
    if (name) { this.iconSprite = icon(name); this.iconSprite.scale.multiplyScalar(0.8); this.iconSprite.position.y = 2.35; this.root.add(this.iconSprite); }
  }
  setAnim(name, speed = 1) {
    this.actions[name].timeScale = speed;
    if (name === this.current) return;
    const from = this.actions[this.current], to = this.actions[name];
    to.reset(); to.setEffectiveWeight(1); to.play();
    from.crossFadeTo(to, 0.2, false);
    this.current = name;
  }
  update(dt, x, z, rot, state, opts = {}) {
    this.root.position.set(x, 0, z);
    let d = rot - this.visRot; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.visRot += d * Math.min(1, dt * 12);
    this.body.rotation.y = this.visRot;
    const crouchTarget = opts.crouch ?? ((state === 3 || state === 4) ? 0.82 : 1);
    this.crouch += (crouchTarget - this.crouch) * Math.min(1, dt * 10);
    const lieTarget = opts.lie ? 1 : 0;
    this.lie += (lieTarget - this.lie) * Math.min(1, dt * 6);
    this.holder.scale.set(1, this.crouch, 1);
    this.tilt.rotation.x = this.lie * Math.PI / 2 * 0.97;
    this.tilt.position.y = this.lie * 0.12;
    if (this.label) this.label.position.y = 2.15 * this.crouch;
    if (this.iconSprite) this.iconSprite.position.y = this.lie > 0.5 ? 0.9 : 2.35 * this.crouch;
    const anim = opts.anim ?? (state === 2 ? 'run' : (state === 1 || state === 3) ? 'walk' : 'idle');
    this.setAnim(anim, state === 3 ? 0.62 : opts.carry ? 0.8 : 1);
    if (opts.lie && this.lie > 0.9) return; // leżący – bez animacji
    this.mixer.update(dt);
  }
}

export class Game {
  constructor(container, net, you, room) {
    this.container = container; this.net = net; this.you = you; this.room = room;
    this.chars = new Map(); this.npcs = new Map();
    this.keys = new Set();
    this.seq = 0; this.pending = [];
    this.acc = 0; this.pings = [];
    this.viewSize = 13;
    this.mode = localStorage.getItem('skok-cam') === 'iso' ? 'iso' : 'tps';
    this.yaw = Math.PI / 4; this.pitch = 0.32; this.tpsDist = 3.2; this.camDist = 3.2;
    this.camTarget = new THREE.Vector3();
    this.mouse = new THREE.Vector2();
    this.running = false;
    this.snapCount = 0; this.lastSnapRate = 0;
    this.hs = null; this.me = { masked: false, carry: false, act: -1, ties: 4 };
    this.maskHold = 0; this.actSent = null;
    this.log = [];
    this.bagMeshes = new Map();
  }

  async start(msg) {
    this.map = parseMap(MAPS[msg.map]);
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    this.container.innerHTML = ''; this.container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.map.daytime ? '#9db7d4' : '#05070b');
    const aspect = innerWidth / innerHeight;
    this.isoCam = new THREE.OrthographicCamera(-this.viewSize * aspect / 2, this.viewSize * aspect / 2, this.viewSize / 2, -this.viewSize / 2, 0.1, 200);
    this.tpsCam = new THREE.PerspectiveCamera(62, aspect, 0.05, 150);
    this.camOffset = new THREE.Vector3(Math.cos(CAM_ELEV) / Math.SQRT2, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV) / Math.SQRT2).multiplyScalar(CAM_DIST);

    const [marble, soldier, xbot, woman, man] = await Promise.all([new THREE.TextureLoader().loadAsync('/assets/marble_tile.jpg'),
      loadModel('Soldier'), loadModel('Xbot'), loadModel('Woman'), loadModel('Man')]);
    this.marble = marble; this.soldier = soldier; this.xbot = xbot; this.woman = woman; this.man = man;
    this.clipsWoman = retargetWorld(xbot, woman, (n) => n, ['idle', 'walk', 'run']);
    this.clipsMan = retargetWorld(xbot, man, (n) => 'mixamorig' + n, ['idle', 'walk', 'run']);
    this.applyMode();

    for (const p of msg.players) this.addChar(p);
    for (const n of msg.npcs) this.addNpc(n);
    const mine = this.chars.get(this.you);
    this.pred = { x: mine.x, z: mine.z, rot: mine.rot, state: 0, role: mine.role, carry: false };
    this.prevPred = { ...this.pred };
    this.offset = new THREE.Vector2();
    this.camTarget.set(mine.x, 0, mine.z);
    this.yaw = mine.rot + Math.PI;

    this.myLight = new THREE.PointLight('#c8d6ff', this.map.daytime ? 0.6 : 2.2, 4.5, 1.5);
    this.scene.add(this.myLight);
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.bagMeshes = new Map();
    this.bind();
    this.renderTeam();
    $('#hud-crew').textContent = this.room?.crew || '';
    $('#hud-code').textContent = this.room?.code || '';
    $('#hud-log').innerHTML = '';
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
    this.netTimer = setInterval(() => { this.lastSnapRate = this.snapCount; this.snapCount = 0; }, 1000);
  }

  addChar(p) {
    const c = new Character(this.soldier, { ...p, color: ROLES[p.role]?.color || '#fff', faceOffset: Math.PI });
    this.scene.add(c.root); c.root.position.set(p.x, 0, p.z);
    this.chars.set(p.id, c); this.styleChar(c);
  }

  addNpc(n) {
    const PANTS = ['#2b3a55', '#3a3a3a', '#4a3b2a', '#1f2430', '#5a5040'];
    const SHOES = ['#1a1a1a', '#3a2a1e', '#d8d8d8'];
    const pick = (arr) => arr[n.id % arr.length];
    let model = this.man, clips = this.clipsMan, recolor = null, hide = ['Wolf3D_Headwear'], scale = 1, cap = false;
    if (n.kind === 'guard') {
      recolor = { Wolf3D_Outfit_Top: '#24345a', Wolf3D_Outfit_Bottom: '#1a1f2c', Wolf3D_Outfit_Footwear: '#111111' }; cap = true;
    } else if (n.kind === 'manager') {
      recolor = { Wolf3D_Outfit_Top: '#2a2a30', Wolf3D_Outfit_Bottom: '#2a2a30', Wolf3D_Outfit_Footwear: '#120c08' };
    } else if (n.kind === 'teller' && n.id % 2 === 1) {
      model = this.woman; clips = this.clipsWoman;
    } else if (n.kind === 'teller') {
      recolor = { Wolf3D_Outfit_Top: '#f1efe8', Wolf3D_Outfit_Bottom: '#2b2b30' }; hide.push('Wolf3D_Beard');
    } else if (n.id % 2 === 0) {
      model = this.woman; clips = this.clipsWoman; scale = 0.97 + (n.id % 5) * 0.015;
    } else {
      recolor = { Wolf3D_Outfit_Top: n.color, Wolf3D_Outfit_Bottom: pick(PANTS), Wolf3D_Outfit_Footwear: pick(SHOES) };
      if (n.id % 4 === 1) hide.push('Wolf3D_Beard');
      scale = 0.95 + (n.id % 7) * 0.012;
    }
    const c = new Character(model, { id: n.id, npc: true, kind: n.kind, clips, recolor, hide, scale, cap, x: -100, z: -100 });
    this.scene.add(c.root); c.root.visible = false;
    this.npcs.set(n.id, c);
  }

  renderTeam() {
    $('#hud-team').innerHTML = [...this.chars.values()].map((c) => {
      const role = ROLES[c.role];
      return `<li>${c.mask ? '🎭 ' : ''}${c.bag ? '💰 ' : ''}${c.nick}${c.id === this.you ? ' (ty)' : ''} <span style="color:${role?.color}">${role?.name || ''}</span><span class="sw" style="background:${role?.color}"></span></li>`;
    }).join('');
  }

  // ---------- tryb kamery ----------
  get camera() { return this.mode === 'tps' ? this.tpsCam : this.isoCam; }

  applyMode() {
    if (this.world) this.world.dispose();
    this.world = buildWorld(this.scene, this.map, this.marble, { allTall: this.mode === 'tps' });
    if (this.renderer && !this.renderer.shadowMap.enabled) this.world.moon.castShadow = false;
    for (const c of this.chars.values()) this.styleChar(c);
    document.body.classList.toggle('tps', this.mode === 'tps');
    try { localStorage.setItem('skok-cam', this.mode); } catch {}
    if (this.hs) this.applyHeistVisuals(true);
  }

  styleChar(c) {
    const tps = this.mode === 'tps', me = c.id === this.you;
    c.label.visible = !(tps && me);
    c.label.scale.set(tps ? 1.0 : 1.6, tps ? 0.25 : 0.4, 1);
    c.ring.visible = !(tps && me);
  }

  toggleMode() {
    this.mode = this.mode === 'tps' ? 'iso' : 'tps';
    if (this.mode === 'iso' && document.pointerLockElement) document.exitPointerLock();
    this.applyMode(); this.onResize();
    $('#hud-click').classList.toggle('hidden', !!document.pointerLockElement || this.mode !== 'tps');
  }

  relock() { if (this.mode === 'tps') this.renderer.domElement.requestPointerLock?.(); }

  // kierunek „przed siebie” do krzyku i rzutu
  aimYaw() {
    if (this.mode === 'tps') return this.yaw + Math.PI;
    return this.pred.rot;
  }

  // ---------- sterowanie ----------
  bind() {
    const canvas = this.renderer.domElement;
    this.onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.code;
      if (k === 'Escape') { $('#pause').classList.toggle('hidden'); return; }
      if (e.repeat) { this.keys.add(k); return; }
      if (k === 'KeyF') this.sendPing('go');
      if (k === 'KeyV') this.sendPing('danger');
      if (k === 'KeyT') this.toggleMode();
      if (k === 'KeyQ') this.net.send({ t: 'shout', yaw: this.aimYaw() });
      if (k === 'KeyB') this.net.send({ t: 'throw', yaw: this.aimYaw() });
      this.keys.add(k);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.onMouse = (e) => {
      this.mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      const rotating = document.pointerLockElement === canvas || this.rmb;
      if (rotating && this.mode === 'tps') {
        this.yaw -= e.movementX * 0.0032;
        this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0026, -0.35, 1.15);
      }
    };
    this.onDown = (e) => {
      if (e.button === 1) { e.preventDefault(); this.sendPing('go'); }
      if (e.button === 2) this.rmb = true;
      if (e.button === 0 && this.mode === 'tps' && e.target === canvas && !document.pointerLockElement) canvas.requestPointerLock?.();
    };
    this.onUp = (e) => { if (e.button === 2) this.rmb = false; };
    this.onContext = (e) => e.preventDefault();
    this.onLockChange = () => {
      if (!document.pointerLockElement && this.mode === 'tps' && this.running && this.hadLock && !this.ended) $('#pause').classList.remove('hidden');
      this.hadLock = !!document.pointerLockElement;
      $('#hud-click').classList.toggle('hidden', this.hadLock || this.mode !== 'tps');
    };
    this.onWheel = (e) => {
      if (this.mode === 'tps') this.tpsDist = THREE.MathUtils.clamp(this.tpsDist * (e.deltaY > 0 ? 1.1 : 0.9), 1.6, 6);
      else { this.viewSize = THREE.MathUtils.clamp(this.viewSize * (e.deltaY > 0 ? 1.1 : 0.9), 7, 28); this.onResize(); }
    };
    this.onResize = () => {
      const a = innerWidth / innerHeight, v = this.viewSize;
      Object.assign(this.isoCam, { left: -v * a / 2, right: v * a / 2, top: v / 2, bottom: -v / 2 });
      this.isoCam.updateProjectionMatrix();
      this.tpsCam.aspect = a; this.tpsCam.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    this.listeners = [['keydown', this.onKeyDown], ['keyup', this.onKeyUp], ['blur', this.onBlur], ['mousemove', this.onMouse],
      ['mousedown', this.onDown], ['mouseup', this.onUp], ['contextmenu', this.onContext], ['wheel', this.onWheel], ['resize', this.onResize]];
    for (const [ev, f] of this.listeners) addEventListener(ev, f, ev === 'wheel' ? { passive: true } : undefined);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.onLockChange();
  }

  readInput() {
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp'), down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft'), right = k.has('KeyD') || k.has('ArrowRight');
    let iy = (up ? 1 : 0) - (down ? 1 : 0), ix = (right ? 1 : 0) - (left ? 1 : 0);
    if (this.me.act >= 0 && k.has('KeyE')) { iy = 0; ix = 0; } // podczas interakcji stoimy
    const yaw = this.mode === 'tps' ? this.yaw : Math.PI / 4;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = fx * iy + rx * ix, mz = fz * iy + rz * ix;
    const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
    const sneak = k.has('KeyC');
    return { mx, mz, run: (k.has('ShiftLeft') || k.has('ShiftRight')) && !sneak, sneak };
  }

  sendPing(kind) {
    this.raycaster.setFromCamera(this.mode === 'tps' ? new THREE.Vector2(0, 0) : this.mouse, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return;
    if (this.mode === 'tps') {
      const o = this.raycaster.ray.origin, d = hit.clone().sub(o), len = d.length(); d.normalize();
      for (let t = 0; t < len; t += 0.1) {
        const p = o.clone().addScaledVector(d, t);
        if (p.y < 3 && CAM_BLOCK.has(this.map.at(Math.floor(p.x), Math.floor(p.z)))) { hit.copy(o).addScaledVector(d, Math.max(0, t - 0.3)); hit.y = 0; break; }
      }
    }
    this.net.send({ t: 'ping', x: hit.x, z: hit.z, kind });
  }

  // ---------- interakcje ----------
  candidates() {
    const hs = this.hs; if (!hs) return [];
    const out = [], done = new Set(hs.done), m = this.map, me = this.me;
    const mine = hs.keycard === this.you;
    const around = (fn) => {
      const px = Math.floor(this.pred.x), pz = Math.floor(this.pred.z);
      for (let z = pz - 2; z <= pz + 2; z++) for (let x = px - 2; x <= px + 2; x++) fn(m.at(x, z), x, z, key(x, z));
    };
    around((ch, x, z, k) => {
      const c = { id: k, x: x + 0.5, z: z + 0.5 };
      if (ch === 'R' && !done.has(k)) out.push({ ...c, label: 'Opróżnij kasę' });
      if (ch === 'K' && hs.keycard === 'desk') out.push({ ...c, label: 'Zabierz kartę kierownika' });
      if (ch === 'M' && !hs.looped && m.at(x - 2, z) !== 'M') out.push({ ...c, label: this.pred.role === 'haker' ? 'Zapętl kamery (szybko)' : 'Zapętl kamery' });
      if (ch === 'L' && !done.has(k)) out.push({ ...c, label: mine ? 'Otwórz kartą' : 'Otwórz wytrychem' });
      if (ch === 'V') {
        if (hs.vault === 'closed') out.push({ ...c, label: mine ? 'Otwórz skarbiec kartą (cicho)' : 'Postaw wiertło (głośno!)' });
        if (hs.vault === 'drilling' && hs.drill.jam) out.push({ ...c, label: 'Napraw wiertło' });
      }
      if (ch === '$' && !done.has(k) && !me.carry) out.push({ ...c, label: 'Spakuj pieniądze do worka' });
    });
    if (!me.carry) for (const [id, x, z] of hs.bags) out.push({ id, x, z, label: 'Podnieś worek' });
    if (me.ties > 0) for (const c of this.npcs.values()) {
      if (!c.root.visible) continue;
      if (c.stateName === 'down' || c.stateName === 'surrender') out.push({ id: 'npc' + c.id, x: c.root.position.x, z: c.root.position.z, label: `Zwiąż (opaski: ${me.ties})` });
    }
    const px = this.pred.x, pz = this.pred.z;
    return out.map((c) => ({ ...c, d: Math.hypot(c.x - px, c.z - pz) })).filter((c) => c.d < 1.7).sort((a, b) => a.d - b.d);
  }

  updateInteraction(dt) {
    const cand = this.candidates()[0];
    const holding = this.keys.has('KeyE');
    const want = holding && cand ? cand.id : null;
    if (want !== this.actSent) { this.net.send({ t: 'act', id: want }); this.actSent = want; }
    const prompt = $('#hud-prompt');
    // maska
    if (!this.me.masked && this.keys.has('KeyG')) {
      this.maskHold += dt;
      if (this.maskHold >= 0.9 && !this.maskSent) { this.net.send({ t: 'mask' }); this.maskSent = true; }
    } else this.maskHold = 0;
    if (!this.me.masked && this.maskHold > 0) {
      prompt.classList.remove('hidden'); $('#prompt-text').textContent = 'Zakładasz maskę…';
      $('#prompt-bar').style.width = Math.min(100, this.maskHold / 0.9 * 100) + '%';
      return;
    }
    if (cand) {
      prompt.classList.remove('hidden');
      $('#prompt-text').innerHTML = `<kbd>E</kbd> przytrzymaj: ${cand.label}`;
      $('#prompt-bar').style.width = (holding && this.me.act >= 0 ? this.me.act * 100 : 0) + '%';
    } else if (this.me.carry) {
      prompt.classList.remove('hidden'); $('#prompt-text').innerHTML = '<kbd>B</kbd> rzuć worek · zanieś go do żółtej strefy przy furgonetce'; $('#prompt-bar').style.width = '0%';
    } else prompt.classList.add('hidden');
  }

  // ---------- sieć ----------
  onSnap(m) {
    if (!this.pred) return; // jeszcze się ładujemy
    this.snapCount++;
    const now = performance.now();
    const seen = new Set();
    let teamChanged = false;
    for (const [id, x, z, rot, state, lastSeq, masked, carry, act, ties] of m.p) {
      seen.add(id);
      const c = this.chars.get(id);
      if (!c) continue;
      if (!!masked !== !!c.mask) { c.setMask(!!masked, ROLES[c.role]?.color || '#fff'); teamChanged = true; }
      if (!!carry !== !!c.bag) { c.setCarry(!!carry); teamChanged = true; }
      if (id === this.you) {
        this.me = { masked: !!masked, carry: !!carry, act, ties };
        this.pred.carry = !!carry;
        const before = { x: this.pred.x, z: this.pred.z };
        const p = { x, z, rot: this.pred.rot, state: this.pred.state, role: this.pred.role, carry: !!carry };
        this.pending = this.pending.filter((i) => i.seq > lastSeq);
        for (const i of this.pending) stepPlayer(this.map, p, i);
        this.pred = p;
        this.offset.x += before.x - p.x; this.offset.y += before.z - p.z;
        if (this.offset.length() > 2) this.offset.set(0, 0);
      } else {
        c.buffer.push({ t: now, x, z, rot, state, carry });
        if (c.buffer.length > 30) c.buffer.shift();
      }
    }
    for (const id of [...this.chars.keys()]) {
      if (!seen.has(id)) { this.scene.remove(this.chars.get(id).root); this.chars.delete(id); teamChanged = true; }
    }
    if (teamChanged) this.renderTeam();
    const nseen = new Set();
    for (const [id, x, z, rot, anim, st, susp] of m.n || []) {
      const c = this.npcs.get(id); if (!c) continue;
      nseen.add(id);
      if (!c.root.visible) { c.root.visible = true; c.root.position.set(x, 0, z); c.visRot = rot; c.buffer = []; }
      c.buffer.push({ t: now, x, z, rot, anim, st, susp });
      if (c.buffer.length > 30) c.buffer.shift();
    }
    for (const c of this.npcs.values()) if (!nseen.has(c.id)) c.root.visible = false;
  }

  onHeist(hs) {
    const prev = this.hs;
    this.hs = hs;
    if (!this.world || !this.pred) return;
    // drzwi otwarte – kolizje i wygląd
    this.map.open.clear(); for (const d of hs.doors) this.map.open.add(d);
    this.applyHeistVisuals(false, prev);
    this.renderObjectives();
  }

  applyHeistVisuals(force) {
    const hs = this.hs, dyn = this.world.dyn; if (!hs) return;
    const done = new Set(hs.done);
    for (const [k, g] of dyn.cash) g.visible = !done.has(k);
    for (const [k, d] of dyn.registers) d.visible = !done.has(k);
    for (const [k, pivot] of dyn.doors) pivot.userData.target = done.has(k) || hs.doors.includes(k) ? -Math.PI / 2 : 0;
    if (dyn.keycard) dyn.keycard.visible = hs.keycard === 'desk';
    if (dyn.vault) dyn.vault.userData.target = hs.vault === 'open' ? 1.7 : 0;
    if (dyn.drill) dyn.drill.visible = hs.vault === 'drilling';
    for (const led of dyn.camLeds) led.material = hs.cams ? this.world.materials.led : this.world.materials.ledOff;
    // worki na podłodze
    const ids = new Set(hs.bags.map((b) => b[0]));
    for (const [id, mesh] of this.bagMeshes) if (!ids.has(id) || force) { this.scene.remove(mesh); this.bagMeshes.delete(id); }
    for (const [id, x, z] of hs.bags) {
      let mesh = this.bagMeshes.get(id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 6, 12), new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.8 }));
        mesh.rotation.z = Math.PI / 2; mesh.castShadow = true; this.scene.add(mesh); this.bagMeshes.set(id, mesh);
      }
      mesh.position.set(x, 0.18, z);
    }
  }

  renderObjectives() {
    const hs = this.hs, me = this.me; if (!hs) return;
    const cashLeft = hs.cashTotal - hs.done.filter((k) => this.map.at(...k.split(',').map(Number)) === '$').length;
    const lines = [];
    const li = (text, state = '') => lines.push(`<li class="${state}">${text}</li>`);
    if (!me.masked) li('Rozejrzyj się bez maski – jesteś zwykłym klientem. Gdy ekipa gotowa: przytrzymaj <kbd>G</kbd>');
    else li('Zastraszaj: <kbd>Q</kbd> krzyk – ludzie się kładą, strażnik po 2 krzykach się poddaje', 'muted');
    li(hs.keycard === 'desk' ? '(opcjonalnie) Karta kierownika – biuro na zapleczu: cichy skarbiec' : 'Karta kierownika zdobyta ✓', hs.keycard === 'desk' ? 'opt' : 'done');
    li(hs.cams ? '(opcjonalnie) Zwiąż ochronę albo zapętl kamery w pokoju ochrony' : 'Kamery nie działają ✓', hs.cams ? 'opt' : 'done');
    if (hs.vault === 'closed') li('Otwórz skarbiec: kartą (cicho) albo wiertłem (głośno)');
    else if (hs.vault === 'drilling') li(`Wiertło: ${Math.round(hs.drill.prog * 100)}%${hs.drill.jam ? ' – <b class="bad">ZACIĘTE, napraw (E)!</b>' : ''}`);
    else li(`Spakuj pieniądze ze skarbca: zostało ${cashLeft}`);
    li(`Worki w furgonetce: <b>${hs.secured}</b> × ${money(MAPS.bank.bagValue)}${hs.loose ? ` · z kas: ${money(hs.loose)}` : ''}`);
    if (hs.secured > 0 || hs.loose > 0) li('Gdy macie dość – wszyscy do żółtej strefy przy furgonetce' + (hs.escapeT > 0 ? ` (${(3 - hs.escapeT).toFixed(1)} s)` : ''), 'go');
    $('#hud-obj').innerHTML = lines.join('');
    const ph = $('#hud-phase');
    if (hs.alarm) {
      const t = hs.policeT; ph.className = 'hud-phase alarm';
      ph.innerHTML = `ALARM · policja za ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}<small>${hs.reason}</small>`;
    } else if (!me.masked) {
      const restricted = ['r', '_', ':', 'v', 'h'].includes(this.map.at(Math.floor(this.pred.x), Math.floor(this.pred.z)));
      ph.className = 'hud-phase ' + (restricted ? 'warn' : 'casing');
      ph.innerHTML = restricted ? 'STREFA DLA PERSONELU<small>strażnicy i kamery zaczynają coś podejrzewać – nie zostawaj długo</small>' : 'ROZPOZNANIE<small>bez maski nikt cię nie podejrzewa – poza strefami dla personelu</small>';
    }
    else { ph.className = 'hud-phase stealth'; ph.innerHTML = 'PO CICHU<small>nikt jeszcze nie wezwał policji</small>'; }
    $('#hud-me').innerHTML = `${me.masked ? '🎭 maska' : 'bez maski'} · opaski: ${me.ties}${me.carry ? ' · <b>niesiesz worek</b>' : ''}`;
  }

  onEvent(m) {
    if (!this.pred) return;
    const el = document.createElement('div');
    el.className = `log-item ${m.kind}`; el.textContent = m.text;
    const box = $('#hud-log'); box.prepend(el);
    while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => el.classList.add('old'), 7000);
  }

  onShout(m) {
    const c = this.chars.get(m.id); if (!c) return;
    const s = textSprite('NA ZIEMIĘ!', '#ffffff', 34); s.position.y = 2.6; c.root.add(s);
    setTimeout(() => c.root.remove(s), 1100);
  }

  onEnd(m) {
    this.ended = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    $('#results').classList.remove('hidden');
    $('#res-title').textContent = m.success ? 'UDANY SKOK' : 'NAPAD NIEUDANY';
    $('#res-title').className = m.success ? 'ok' : 'bad';
    $('#res-reason').textContent = m.reason;
    $('#res-table').innerHTML =
      row(`Worki (${m.secured} × ${money(MAPS.bank.bagValue)})`, money(m.secured * MAPS.bank.bagValue)) +
      row('Gotówka z kas', money(m.loose)) +
      row('Mnożnik trudności', '×' + m.mult) +
      (m.stealth ? row('Premia za cichy napad', '×1.5') : '') +
      (!m.success ? row('Porażka – zostaje połowa wyniesionego', '×0.5') : '') +
      `<tr class="sum"><td>Razem</td><td>${money(m.total)}</td></tr>` +
      `<tr class="sum"><td>Na głowę</td><td>${money(m.cut)}</td></tr>`;
    $('#res-wallets').innerHTML = Object.entries(m.wallets).map(([n, w]) => `<li>${n}: <b>${money(w)}</b></li>`).join('');
  }

  onPing(m) {
    const c = this.chars.get(m.id);
    const color = new THREE.Color(m.kind === 'danger' ? '#ff3b3b' : (ROLES[c?.role]?.color || '#ffffff'));
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 40), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    beam.position.y = 1.5;
    const label = textSprite(m.kind === 'danger' ? '! UWAGA' : (c?.nick || ''), '#' + color.getHexString());
    label.position.y = 3.2;
    g.add(ring, beam, label); g.position.set(m.x, 0, m.z); this.scene.add(g);
    this.pings.push({ g, ring, beam, label, t: 0 });
  }

  // Kamera zza pleców z odsuwaniem od ścian.
  updateTpsCamera(px, pz, dt) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const pivot = new THREE.Vector3(px + rx * SHOULDER, PIVOT_H, pz + rz * SHOULDER);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(-fx * cp, sp, -fz * cp);
    let allowed = this.tpsDist;
    const roof = this.map.roof;
    for (let t = 0.1; t <= this.tpsDist; t += 0.05) {
      const p = pivot.clone().addScaledVector(dir, t);
      const tx = Math.floor(p.x), tz = Math.floor(p.z);
      const indoor = roof && tx >= roof[0] && tx <= roof[2] && tz >= roof[1] && tz <= roof[3];
      const ch = this.map.at(tx, tz);
      const blocked = (CAM_BLOCK.has(ch) && !((ch === 'L' || ch === 'V') && this.map.open.has(key(tx, tz)))) || (indoor && p.y > 2.85) || p.y < 0.15;
      if (blocked) { allowed = Math.max(0.3, t - 0.25); break; }
    }
    this.camDist += (allowed - this.camDist) * Math.min(1, dt * (allowed < this.camDist ? 25 : 4));
    const cam = this.tpsCam;
    cam.position.copy(pivot).addScaledVector(dir, this.camDist);
    const target = pivot.clone().addScaledVector(dir, -3); target.y += 0.55;
    cam.lookAt(target);
  }

  interp(c, now) {
    const rt = now - INTERP_DELAY, b = c.buffer;
    if (!b.length) return null;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const a = b[Math.max(0, i - 1)], n = b[i];
    const k = n.t === a.t ? 1 : THREE.MathUtils.clamp((rt - a.t) / (n.t - a.t), 0, 1);
    return { ...n, x: THREE.MathUtils.lerp(a.x, n.x, k), z: THREE.MathUtils.lerp(a.z, n.z, k) };
  }

  // ---------- pętla ----------
  frame(t) {
    if (!this.running) return;
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t;

    this.acc += dt;
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      const inp = { ...this.readInput(), seq: ++this.seq };
      this.net.send({ t: 'input', ...inp });
      this.pending.push(inp);
      this.prevPred = { ...this.pred };
      stepPlayer(this.map, this.pred, inp);
    }
    const alpha = this.acc / TICK_DT;
    this.offset.multiplyScalar(Math.pow(0.0001, dt));

    const now = performance.now();
    for (const c of this.chars.values()) {
      if (c.id === this.you) {
        const x = THREE.MathUtils.lerp(this.prevPred.x, this.pred.x, alpha) + this.offset.x;
        const z = THREE.MathUtils.lerp(this.prevPred.z, this.pred.z, alpha) + this.offset.y;
        c.update(dt, x, z, this.pred.rot, this.pred.state, { carry: this.me.carry });
        this.myLight.position.set(x, 2.2, z);
        $('#hud-stance').textContent = this.me.carry && this.pred.role !== 'miesniak' ? 'Z workiem – wolniej' : STANCE_LABEL[this.pred.state];
        this.camTarget.lerp(new THREE.Vector3(x, 0, z), Math.min(1, dt * 6));
      } else {
        const s = this.interp(c, now);
        if (s) { c.x = s.x; c.z = s.z; c.rot = s.rot; c.state = s.state; }
        c.update(dt, c.x, c.z, c.rot, c.state, { carry: s?.carry });
      }
    }
    for (const c of this.npcs.values()) {
      if (!c.root.visible) continue;
      const s = this.interp(c, now); if (!s) continue;
      const st = NPC_ST[s.st] || 'calm';
      c.stateName = st;
      const lie = st === 'down' || st === 'tied';
      c.update(dt, s.x, s.z, s.rot, 0, { anim: s.anim === 2 ? 'run' : s.anim === 1 ? 'walk' : 'idle', lie, crouch: st === 'surrender' ? 0.62 : 1 });
      let ic = null;
      if (st === 'panic' || st === 'flee') ic = 'panic';
      else if (st === 'alert') ic = 'alert';
      else if (st === 'calling') ic = 'calling';
      else if (st === 'down') ic = 'down';
      else if (st === 'tied') ic = 'tied';
      else if (st === 'surrender') ic = 'surrender';
      else if (s.susp > 0.15) ic = 'susp';
      c.setIcon(ic);
      if (ic === 'susp') c.iconSprite.material.opacity = 0.4 + s.susp * 0.6;
    }

    // animacje drzwi i skarbca
    const dyn = this.world.dyn;
    for (const pivot of dyn.doors.values()) pivot.rotation.y += ((pivot.userData.target || 0) - pivot.rotation.y) * Math.min(1, dt * 4);
    if (dyn.vault) dyn.vault.rotation.y += ((dyn.vault.userData.target || 0) - dyn.vault.rotation.y) * Math.min(1, dt * 1.5);
    if (dyn.drill?.visible && this.hs && !this.hs.drill.jam) dyn.drill.children[1].rotation.y += dt * 30;
    if (dyn.zone) dyn.zone.material.opacity = 0.16 + Math.sin(t / 300) * 0.08;

    if (this.mode === 'tps') {
      const me = this.chars.get(this.you);
      if (me) this.updateTpsCamera(me.root.position.x, me.root.position.z, dt);
    } else {
      this.isoCam.position.copy(this.camTarget).add(this.camOffset);
      this.isoCam.lookAt(this.camTarget);
    }

    const me = this.chars.get(this.you);
    if (me) {
      const px = me.root.position.x, pz = me.root.position.z;
      const cam = this.camera.position;
      let hx = cam.x - px, hz = cam.z - pz; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      const reach = this.mode === 'tps' ? Math.min(hl, 8) : 5;
      for (const f of this.world.fadeables) {
        const vx = f.x - px, vz = f.z - pz;
        const depth = vx * hx + vz * hz, side = Math.abs(vx * hz - vz * hx);
        const target = depth > 0 && depth < reach && side < (this.mode === 'tps' ? 0.75 : 1.1) ? 0.22 : 1;
        f.opacity += (target - f.opacity) * Math.min(1, dt * 8);
        for (const m of f.mats) { m.opacity = f.opacity; m.depthWrite = f.opacity > 0.95; }
      }
    }

    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]; p.t += dt;
      const s = 1 + (p.t * 2.2) % 1.2;
      p.ring.scale.set(s, s, s);
      const fade = Math.max(0, 1 - Math.max(0, p.t - 2) / 0.6);
      p.ring.material.opacity = fade * (1 - (s - 1) / 1.4);
      p.beam.material.opacity = 0.8 * fade; p.label.material.opacity = fade;
      if (p.t > 2.6) { this.scene.remove(p.g); this.pings.splice(i, 1); }
    }

    if (!this.ended) this.updateInteraction(dt);
    if (this.hs && (this.objT = (this.objT || 0) + dt) > 0.2) { this.objT = 0; this.renderObjectives(); }
    $('#hud-net').textContent = `serwer: ${this.lastSnapRate}/s · graczy: ${this.chars.size}`;
    this.renderer.render(this.scene, this.camera);
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.world.moon.castShadow = on;
    this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.needsUpdate = true); });
  }

  stop() {
    this.running = false;
    this.renderer?.setAnimationLoop(null);
    clearInterval(this.netTimer);
    for (const [ev, f] of this.listeners || []) removeEventListener(ev, f);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (document.pointerLockElement) document.exitPointerLock();
    document.body.classList.remove('tps');
    this.renderer?.dispose();
    this.container.innerHTML = '';
    $('#results').classList.add('hidden');
  }
}
