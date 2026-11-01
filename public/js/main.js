// Połączenie z serwerem, ekran startowy i lobby.
import { ROLES, DIFFICULTIES } from '/shared/sim.js';

const $ = (s) => document.querySelector(s);
const state = { you: null, room: null, crew: null, game: null, ws: null, queue: [] };

// ---------- sieć ----------
const net = {
  handlers: {},
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    state.ws = ws;
    ws.onopen = () => { for (const m of state.queue) ws.send(JSON.stringify(m)); state.queue = []; };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); (net.handlers[m.t] || (() => {}))(m); };
    ws.onclose = () => {
      toast('Utracono połączenie z serwerem. Odśwież stronę.');
      if (state.game) { state.game.stop(); state.game = null; }
      show('start');
    };
  },
  send(m) {
    if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(m));
    else state.queue.push(m);
  },
  on(t, f) { this.handlers[t] = f; },
};

// ---------- pomocnicze ----------
function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `screen-${name}`);
}
let toastTimer;
function toast(msg, ok = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show${ok ? ' ok' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('pl-PL');

// ---------- ekran startowy ----------
for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
    for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('active', p.id === `form-${tab.dataset.tab}`);
  };
}
const saved = JSON.parse(localStorage.getItem('skok') || '{}');
for (const f of ['#form-host', '#form-join']) if (saved.nick) $(f).nick.value = saved.nick;
if (saved.crew) $('#form-host').crew.value = saved.crew;
const urlCode = new URLSearchParams(location.search).get('pokoj');
if (urlCode) { $('.tab[data-tab="join"]').click(); $('#form-join').code.value = urlCode.toUpperCase(); }

function remember(obj) {
  try { localStorage.setItem('skok', JSON.stringify({ ...JSON.parse(localStorage.getItem('skok') || '{}'), ...obj })); } catch {}
}

$('#form-host').onsubmit = (e) => {
  e.preventDefault();
  const f = e.target, create = e.submitter?.value === 'create';
  remember({ nick: f.nick.value, crew: f.crew.value });
  net.send({ t: 'crewLogin', nick: f.nick.value, name: f.crew.value, pass: f.pass.value, create });
};
$('#form-join').onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  remember({ nick: f.nick.value });
  net.send({ t: 'joinRoom', nick: f.nick.value, code: f.code.value });
};

// ---------- lobby ----------
function me() { return state.room?.players.find((p) => p.id === state.you); }
function isHost() { return state.room && state.room.host === state.you; }

function renderLobby() {
  const r = state.room; if (!r) return;
  $('#lobby-crew').textContent = r.crew;
  $('#lobby-code').textContent = r.code;
  const mine = me();

  $('#role-list').innerHTML = Object.entries(ROLES).map(([id, role]) => {
    const owner = r.players.find((p) => p.role === id);
    const cls = owner ? (owner.id === state.you ? 'mine' : 'locked') : '';
    return `<button class="role ${cls}" data-role="${id}">
      <span class="bar" style="background:${role.color}"></span>
      <span><div class="rn">${role.name}</div><div class="rd">${role.desc}</div></span>
      <span class="taken">${owner ? esc(owner.nick) : ''}</span></button>`;
  }).join('');
  for (const b of document.querySelectorAll('.role')) {
    b.onclick = () => {
      const id = b.dataset.role;
      net.send({ t: 'pickRole', role: mine?.role === id ? null : id });
    };
  }

  $('#player-list').innerHTML = r.players.map((p) => {
    const role = p.role ? ROLES[p.role] : null;
    return `<li><span class="dot" style="background:${role ? role.color : '#444'}"></span>
      <span class="pn">${esc(p.nick)}${p.id === state.you ? ' (ty)' : ''} ${p.id === r.host ? '<span class="host">HOST</span>' : ''}</span>
      <span class="pr">${role ? role.name : 'wybiera…'}</span>
      <span class="pw">${money(p.wallet)}</span>
      <span class="ok">${p.ready ? 'GOTOWY' : ''}</span></li>`;
  }).join('') + Array.from({ length: 5 - r.players.length }, () => '<li><span class="dot"></span><span class="pn" style="color:#555">wolne miejsce</span></li>').join('');

  $('#diff-list').innerHTML = Object.entries(DIFFICULTIES).map(([id, d]) =>
    `<button class="diff ${r.difficulty === id ? 'sel' : ''}" data-d="${id}" ${isHost() ? '' : 'disabled'}>${d.name}<small>wypłata ×${d.payout}</small></button>`).join('');
  for (const b of document.querySelectorAll('.diff')) b.onclick = () => net.send({ t: 'setDifficulty', d: b.dataset.d });

  const ready = mine?.ready;
  $('#btn-ready').textContent = ready ? 'Jednak nie' : 'Gotowy';
  $('#btn-ready').disabled = !mine?.role;
  const allReady = r.players.every((p) => p.role && p.ready);
  $('#btn-start').style.display = isHost() ? '' : 'none';
  $('#btn-start').disabled = !allReady;
  $('#lobby-hint').textContent = isHost()
    ? (allReady ? 'Wszyscy gotowi. Możesz zaczynać.' : 'Czekamy, aż każdy wybierze postać i kliknie „Gotowy”. Do testów wystarczy jedna osoba.')
    : 'Napad rozpoczyna host, gdy wszyscy są gotowi.';
}

$('#btn-ready').onclick = () => net.send({ t: 'ready', v: !me()?.ready });
$('#btn-start').onclick = () => net.send({ t: 'start' });
$('#btn-leave').onclick = () => { net.send({ t: 'leave' }); state.room = null; show('start'); };
$('#lobby-code').onclick = () => {
  const link = `${location.origin}/?pokoj=${state.room.code}`;
  navigator.clipboard?.writeText(link).then(() => toast('Skopiowano link do pokoju', true), () => {});
};

// ---------- komunikaty z serwera ----------
net.on('err', (m) => toast(m.msg));
net.on('joined', (m) => { state.you = m.you; state.crew = m.crew; show('lobby'); });
net.on('room', (m) => {
  state.room = m.room;
  if (m.room.phase === 'lobby' && !state.game) show('lobby');
  const rb = document.querySelector('#btn-res-lobby'); if (rb) rb.textContent = isHost() ? 'Wróć do lobby' : 'Czekamy na hosta…';
  renderLobby();
});
net.on('left', (m) => { if (state.game) toast(`${m.nick} opuścił(a) grę`); });
net.on('leftOk', () => {});
net.on('start', async (m) => {
  show('game');
  $('#loading').classList.remove('hidden');
  const { Game } = await import('/js/game.js');
  state.game = new Game($('#game-canvas'), net, state.you, state.room);
  window.__game = state.game;
  await state.game.start(m);
  $('#loading').classList.add('hidden');
});
net.on('snap', (m) => state.game?.onSnap(m));
net.on('ping', (m) => state.game?.onPing(m));
net.on('hs', (m) => state.game?.onHeist(m));
net.on('ev', (m) => { if (state.game) state.game.onEvent(m); else toast(m.text); });
net.on('shout', (m) => state.game?.onShout(m));
net.on('end', (m) => state.game?.onEnd(m));
$('#btn-res-lobby').onclick = () => { if (isHost()) net.send({ t: 'toLobby' }); else toast('Czekamy, aż host wróci do lobby.'); };
net.on('toLobby', () => {
  if (state.game) { state.game.stop(); state.game = null; }
  $('#pause').classList.add('hidden');
  show('lobby'); renderLobby();
});

// ---------- menu pauzy ----------
$('#btn-resume').onclick = () => { $('#pause').classList.add('hidden'); state.game?.relock(); };
$('#btn-tolobby').onclick = () => { if (isHost()) net.send({ t: 'toLobby' }); else toast('Tylko host może cofnąć ekipę do lobby.'); };
$('#btn-quit').onclick = () => {
  net.send({ t: 'leave' });
  if (state.game) { state.game.stop(); state.game = null; }
  $('#pause').classList.add('hidden'); state.room = null; show('start');
};
$('#opt-shadows').onchange = (e) => state.game?.setShadows(e.target.checked);

// ---------- aktualizacje ----------
const upd = { host: false, local: null };
const setMsg = (t, cls = '') => { const m = $('#update-msg'); m.textContent = t; m.className = 'update-msg ' + cls; };
async function loadVersion() {
  try { const v = await (await fetch('/api/version', { cache: 'no-store' })).json(); upd.host = v.host; upd.local = v; $('#ver-name').textContent = v.name; } catch {}
}
async function checkUpdate(silent) {
  if (!silent) setMsg('Sprawdzam…');
  try {
    const r = await (await fetch('/api/check', { method: 'POST' })).json();
    if (r.error) { if (!silent) setMsg(r.error, 'err'); return; }
    if (r.available) {
      setMsg(`Dostępna nowa wersja: ${r.remote.name}${r.remote.notes ? ' – ' + r.remote.notes : ''}`, 'new');
      if (upd.host) $('#btn-update-go').classList.remove('hidden');
      else setMsg(`Dostępna nowa wersja: ${r.remote.name}. Poproś hosta, żeby kliknął „Aktualizuj”.`, 'new');
    } else if (!silent) setMsg(`Masz najnowszą wersję (${r.local.name}).`);
  } catch { if (!silent) setMsg('Nie udało się sprawdzić aktualizacji.', 'err'); }
}
$('#btn-update-check').onclick = () => checkUpdate(false);
$('#btn-update-go').onclick = async () => {
  $('#btn-update-go').classList.add('hidden');
  setMsg('Pobieram i instaluję… nie zamykaj czarnego okna.');
  try {
    const r = await (await fetch('/api/update', { method: 'POST' })).json();
    if (r.error) { setMsg(r.error, 'err'); return; }
    if (!r.restart) { setMsg('Zainstalowano. Zamknij czarne okno i uruchom START.bat ponownie.', 'new'); return; }
    setMsg('Restartuję serwer…');
    const old = upd.local?.version;
    for (let i = 0; i < 60; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      try { const v = await (await fetch('/api/version', { cache: 'no-store' })).json(); if (v.version !== old) { location.reload(); return; } } catch {}
    }
    setMsg('Serwer nie wstał. Zamknij czarne okno i uruchom START.bat.', 'err');
  } catch { setMsg('Aktualizacja przerwana – spróbuj jeszcze raz.', 'err'); }
};
loadVersion().then(() => checkUpdate(true));

window.__net = net;
net.connect();
net.send({ t: 'hello' });
