const $ = s => document.querySelector(s),
  app = $('#app'),
  letters = ['A', 'B', 'C', 'D'];
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AVATARS = ['🎬', '🍿', '🎭', '🌟', '🦊', '🦁', '🐼', '🐯', '🐸', '🐙', '🦄', '🚀', '⚡', '🎸', '🕵️', '👑'];
const EMOJIS = ['👏', '😂', '😱', '🔥', '🎉', '🤔', '❤️', '🍿'];

const [, route, code] = location.pathname.split('/');
const role = ['admin', 'admin.html'].includes(route)
  ? 'admin'
  : route === 'play'
  ? 'entry'
  : route === 'tv'
  ? 'tv'
  : route === 'host'
  ? 'host'
  : route === 'j'
  ? 'player'
  : route === 'screen'
  ? 'screen'
  : 'home';

const storageKey = `qsd-v2-${role}-${code}`;
let secret = localStorage.getItem(storageKey) || '',
  state,
  selection = null,
  selectedAvatar = localStorage.getItem('qsd-avatar') || '🎬',
  lastRound = '',
  lastPhase = '',
  viewKey = '',
  online = false,
  busy = false,
  offset = 0,
  qr = '',
  soundEnabled = localStorage.getItem('qsd-sound') !== 'off',
  lastTickSecond = -1,
  editingRoundId = null,
  lastVideoSeq = -1,
  localTvVideos = {}; // map of filename -> Blob URL loaded automatically from IndexedDB

const seenReactions = new Set();

/* --- IndexedDB for sharing large local video files from Admin to TV cleanly --- */
function openVideoDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const req = indexedDB.open('qsd-local-videos-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('videos')) {
        db.createObjectStore('videos', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveLocalVideoToIdb(file) {
  try {
    const db = await openVideoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').put({ name: file.name, file, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const blobUrl = URL.createObjectURL(file);
    localTvVideos[file.name] = blobUrl;
    localTvVideos['local:' + file.name] = blobUrl;
    return true;
  } catch {
    return false;
  }
}

async function loadLocalVideosFromIdb() {
  try {
    const db = await openVideoDb();
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readonly');
      const req = tx.objectStore('videos').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const item of items) {
      if (item?.name && item?.file && !localTvVideos[item.name]) {
        const blobUrl = URL.createObjectURL(item.file);
        localTvVideos[item.name] = blobUrl;
        localTvVideos['local:' + item.name] = blobUrl;
      }
    }
  } catch {}
}

loadLocalVideosFromIdb().then(() => {
  if (role === 'screen' && state) {
    viewKey = '';
    render();
  }
});

/* --- BroadcastChannel for zero-latency same-PC sync between Admin and TV --- */
const bc = typeof BroadcastChannel !== 'undefined' && code ? new BroadcastChannel('qsd-room-' + code) : null;
if (bc) {
  bc.onmessage = async e => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'video-cmd' && role === 'screen') {
      applyVideoCommand(msg.videoState, true);
    } else if (msg.type === 'local-video-updated' && role === 'screen') {
      await loadLocalVideosFromIdb();
      viewKey = '';
      render();
    } else if (msg.type === 'refresh') {
      refresh(true).catch(() => {});
    }
  };
}

/* --- Web Audio API Sound Engine --- */
class SoundFX {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (!soundEnabled) return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    if (!this.ctx) this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return true;
  }
  tone(freq, duration = 0.12, type = 'sine', delay = 0, gainVal = 0.14) {
    try {
      if (!this.init()) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {}
  }
  tick(urgent = false) {
    this.tone(urgent ? 880 : 540, 0.08, urgent ? 'triangle' : 'sine', 0, urgent ? 0.16 : 0.09);
  }
  open() {
    [440, 554.37, 659.25].forEach((f, i) => this.tone(f, 0.18, 'triangle', i * 0.06, 0.15));
  }
  close() {
    [330, 220].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', i * 0.12, 0.14));
  }
  reveal() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.35, 'triangle', i * 0.07, 0.18));
  }
  podium() {
    [440, 554.37, 659.25, 880, 1108.73].forEach((f, i) => this.tone(f, 0.5, 'triangle', i * 0.09, 0.18));
  }
  click() {
    this.tone(660, 0.05, 'sine', 0, 0.08);
  }
}
const sfx = new SoundFX();

/* --- Confetti Celebration --- */
function launchConfetti() {
  const canvas = $('#confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#007e88', '#d59b2d', '#00a896', '#f4a261', '#e76f51', '#4755a0'];
  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 200,
    w: 8 + Math.random() * 8,
    h: 6 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    vy: 2.5 + Math.random() * 4,
    vx: -2 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    vrot: -0.1 + Math.random() * 0.2
  }));
  let frame = 0;
  function step() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      if (p.y < canvas.height + 30) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive && frame < 240) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(step);
}

/* --- Floating Reactions --- */
function spawnReactions(list = []) {
  const layer = $('#reactions-layer');
  if (!layer || !Array.isArray(list)) return;
  for (const rx of list) {
    if (!rx.id || seenReactions.has(rx.id)) continue;
    seenReactions.add(rx.id);
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.style.left = 10 + Math.random() * 80 + '%';
    el.innerHTML = `<span class="rx-emoji">${esc(rx.emoji)}</span><small>${esc(rx.name)}</small>`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
}

function notice(s) {
  $('#notice').textContent = s;
  clearTimeout(notice.timer);
  if (s) notice.timer = setTimeout(() => ($('#notice').textContent = ''), 8000);
}

async function request(body) {
  const res = await fetch('/api/game' + (body ? '' : '?code=' + encodeURIComponent(code) + '&view=' + role), {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: 'Bearer ' + secret } : {}) },
    body: body ? JSON.stringify({ code, ...body }) : undefined,
    cache: 'no-store'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudo conectar.');
  return data;
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('qsd-sound', soundEnabled ? 'on' : 'off');
  if (soundEnabled) sfx.click();
  const btn = $('#sound-toggle');
  if (btn) btn.textContent = soundEnabled ? '🔊 Sonido' : '🔇 Silencio';
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

function header() {
  if (role === 'screen') return '';
  const entry = app.classList.contains('entry');
  const roleLabel =
    {
      admin: 'Administración Deluxe',
      host: 'Director · privado',
      player: 'Jugador'
    }[role] || '';
  return `<header class="${entry ? 'entry-header' : ''}">
    ${
      entry
        ? '<div class="deluxe-badge">EDICIÓN DELUXE</div><h1 class="game-title">¿Qué sucede<br><span>después?</span></h1>'
        : '<a class="brand" href="/">¿Qué sucede<br><strong>después?</strong> <span class="brand-badge">DELUXE</span></a>'
    }
    ${
      entry
        ? ''
        : `<div class="header-meta">
            <div class="header-tools">
              <button type="button" id="sound-toggle" class="tool-btn" title="Activar o silenciar efectos de sonido">${
                soundEnabled ? '🔊 Sonido' : '🔇 Silencio'
              }</button>
            </div>
            <span class="tag">${roleLabel}</span>
            <span class="connection"></span>
          </div>`
    }
  </header>`;
}

function bindHeaderTools() {
  if ($('#sound-toggle')) $('#sound-toggle').onclick = toggleSound;
  if ($('#fs-toggle')) $('#fs-toggle').onclick = toggleFullscreen;
}

function status() {
  const el = $('.connection');
  if (el) {
    el.textContent = online ? '● Conectado en vivo' : '○ Sin conexión · reconectando';
    el.className = 'connection ' + (online ? '' : 'offline');
  }
  document.querySelectorAll('[data-live]').forEach(el => {
    el.disabled = !online || busy || (el.id === 'action' && !state?.roundCount);
  });
  bindHeaderTools();
}

function home() {
  app.className = 'entry lobby';
  app.innerHTML =
    header() +
    `<p class="subtitle-lead">Trivia interactiva de clips y películas en vivo para TV, proyectores, Zoom y OBS</p>
    <div class="role-grid">
      <a class="role-card" href="/tv">
        <span class="role-icon" aria-hidden="true">▣</span>
        <h2>Pantalla gigante</h2>
        <p>Video sincronizado, preguntas, gráfico de votos y podio animado.</p>
        <span class="role-arrow" aria-hidden="true">→</span>
      </a>
      <a class="role-card" href="/play">
        <span class="role-icon" aria-hidden="true">▯</span>
        <h2>Jugador</h2>
        <p>Elige tu avatar, entra a tu sala con PIN o QR y responde a tiempo.</p>
        <span class="role-arrow" aria-hidden="true">→</span>
      </a>
      <a class="role-card" href="/admin.html">
        <span class="role-icon" aria-hidden="true">☷</span>
        <h2>Administrador</h2>
        <p>Sube tus videos, marca el corte exacto y pausa o continúa en vivo.</p>
        <span class="role-arrow" aria-hidden="true">→</span>
      </a>
    </div>`;
}

function tvEntry() {
  app.className = 'entry';
  app.innerHTML =
    header() +
    `<form id="screen-code" class="join-card">
      <h2>Pantalla gigante</h2>
      <label>PIN de sala
        <input class="pin-input" name="code" maxlength="6" minlength="6" required placeholder="123456" inputmode="numeric" autocomplete="off">
      </label>
      <button class="primary">Abrir pantalla →</button>
    </form>
    <a class="admin-entry" href="/">← Inicio</a>`;
  $('#screen-code').onsubmit = async e => {
    e.preventDefault();
    const c = e.target.elements.code.value.trim().toUpperCase(),
      btn = e.target.querySelector('button');
    if (!/^(?:[0-9]{6}|[A-Z2-9]{6})$/.test(c)) return notice('Revisa el PIN de seis caracteres.');
    btn.disabled = true;
    try {
      const r = await fetch('/api/game?code=' + encodeURIComponent(c) + '&view=screen');
      const d = await r.json();
      if (!r.ok) throw Error(d.error || 'No encontramos la sala.');
      location.href = '/screen/' + c;
    } catch (err) {
      notice(err.message);
      btn.disabled = false;
    }
  };
}

function avatarPickerHtml() {
  return `<div class="avatar-picker" role="radiogroup" aria-label="Elige tu avatar">
    ${AVATARS.map(
      av =>
        `<button type="button" class="avatar-btn ${selectedAvatar === av ? 'selected' : ''}" data-avatar="${av}" aria-pressed="${
          selectedAvatar === av
        }">${av}</button>`
    ).join('')}
  </div>`;
}

function bindAvatarPicker() {
  document.querySelectorAll('[data-avatar]').forEach(btn => {
    btn.onclick = () => {
      selectedAvatar = btn.dataset.avatar;
      localStorage.setItem('qsd-avatar', selectedAvatar);
      document.querySelectorAll('[data-avatar]').forEach(b => {
        b.classList.toggle('selected', b.dataset.avatar === selectedAvatar);
        b.setAttribute('aria-pressed', b.dataset.avatar === selectedAvatar);
      });
    };
  });
}

function playerEntry() {
  app.className = 'entry';
  app.innerHTML =
    header() +
    `<form id="join-code" class="join-card">
      <h2>Jugador</h2>
      <label>PIN de sala
        <input class="pin-input" name="code" maxlength="6" minlength="6" inputmode="numeric" placeholder="123456" required autocomplete="off" autocapitalize="characters">
      </label>
      <label>Tu nombre
        <input name="name" maxlength="30" placeholder="¿Cómo te llamas?" required autocomplete="nickname">
      </label>
      <label>Tu avatar</label>
      ${avatarPickerHtml()}
      <button class="primary">Entrar a jugar <span aria-hidden="true">→</span></button>
    </form>
    <a class="admin-entry" href="/">← Inicio</a>`;
  bindAvatarPicker();
  $('#join-code').onsubmit = async e => {
    e.preventDefault();
    const f = e.target,
      btn = f.querySelector('button[type="submit"], button.primary'),
      c = f.elements.code.value.trim().toUpperCase();
    if (!/^(?:[0-9]{6}|[A-Z2-9]{6})$/.test(c)) return notice('Revisa el PIN de seis caracteres.');
    btn.disabled = true;
    try {
      const saved = localStorage.getItem('qsd-v2-player-' + c);
      if (!saved) {
        const d = await request({ op: 'join', code: c, name: f.elements.name.value, avatar: selectedAvatar });
        localStorage.setItem('qsd-v2-player-' + c, d.playerToken);
      }
      location.href = '/j/' + c;
    } catch (err) {
      notice(err.message);
      btn.disabled = false;
    }
  };
}

function recentRooms() {
  let rooms = [];
  try {
    rooms = JSON.parse(localStorage.getItem('qsd-rooms') || '[]');
  } catch {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('qsd-v2-host-')) {
      const c = key.slice(12);
      if (!rooms.some(r => r.code === c)) rooms.push({ code: c, title: 'Sala ' + c });
    }
  }
  return rooms.filter(r => /^(?:[0-9]{6}|[A-Z2-9]{6})$/.test(r.code)).slice(0, 20);
}

async function admin() {
  app.className = 'admin';
  app.innerHTML = header() + '<p>Abriendo tus salas…</p>';
  try {
    const session = await request({ op: 'admin-status' });
    const rooms = recentRooms();
    app.innerHTML =
      header() +
      `<h1>${session.authenticated ? 'Panel de Organización Deluxe' : 'Acceso de administrador'}</h1>
      ${
        session.authenticated
          ? `<form id="create">
              <h2>Crear nueva sala</h2>
              <label>Nombre de la actividad
                <input name="title" maxlength="80" placeholder="Gran Noche de Películas" required>
              </label>
              <label>Plantilla inicial de preguntas
                <select name="template">
                  <option value="demo">🎬 Pack Demo con Video Integrado (2 rondas)</option>
                  <option value="cine">🍿 Pack Momentos Inesperados del Cine (4 rondas)</option>
                  <option value="bloopers">😂 Pack Bloopers y Videos Virales (3 rondas)</option>
                  <option value="">✨ Sala en blanco (subir mis propios videos y preguntas)</option>
                </select>
              </label>
              <div class="checkbox-row">
                <label><input type="checkbox" name="speedBonus" checked> ⚡ Bono por rapidez (hasta +300 pts)</label>
                <label><input type="checkbox" name="streakBonus" checked> 🔥 Bono por racha de aciertos</label>
              </div>
              <button class="primary">Crear sala Deluxe →</button>
            </form>
            <div class="row">
              <button id="logout" class="quiet">Cerrar sesión</button>
              <a class="back-link" href="/">← Volver al inicio</a>
            </div>`
          : `<form id="login">
              <label>Clave de administrador (HOST_KEY)
                <input name="key" type="password" autocomplete="current-password" placeholder="Clave por defecto: deluxe" required>
              </label>
              <button class="primary">Entrar</button>
              <p class="form-hint">Clave predeterminada: <code>deluxe</code> (o tu variable <code>HOST_KEY</code> en Vercel). Recordaremos tu sesión 30 días.</p>
            </form>`
      }
      ${
        rooms.length
          ? `<h2>Mis salas recientes</h2>
            <div class="room-list">
              ${rooms
                .map(
                  r =>
                    `<a class="room-link" href="/host/${esc(r.code)}">
                      <span>🎬 ${esc(r.title)}</span>
                      <strong>PIN ${esc(r.code)} →</strong>
                    </a>`
                )
                .join('')}
            </div>`
          : ''
      }`;
    bindHeaderTools();
    if ($('#login'))
      $('#login').onsubmit = async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        try {
          await request({ op: 'login', key: e.target.elements.key.value });
          admin();
        } catch (err) {
          notice(err.message);
          btn.disabled = false;
        }
      };
    if ($('#create'))
      $('#create').onsubmit = async e => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('button');
        btn.disabled = true;
        try {
          const title = f.elements.title.value,
            template = f.elements.template.value,
            speedBonus = f.elements.speedBonus.checked,
            streakBonus = f.elements.streakBonus.checked,
            d = await request({ op: 'create', title, template, speedBonus, streakBonus });
          localStorage.setItem('qsd-v2-host-' + d.code, d.hostToken);
          localStorage.setItem('qsd-rooms', JSON.stringify([{ code: d.code, title }, ...rooms].slice(0, 20)));
          location.href = '/host/' + d.code;
        } catch (err) {
          notice(err.message);
          btn.disabled = false;
        }
      };
    if ($('#logout'))
      $('#logout').onclick = async () => {
        try {
          await request({ op: 'logout' });
          for (const r of recentRooms()) localStorage.removeItem('qsd-v2-host-' + r.code);
          admin();
        } catch (err) {
          notice(err.message);
        }
      };
  } catch (err) {
    app.innerHTML = header() + `<h1>No pudimos abrir tus salas</h1><p>${esc(err.message)}</p><button id="retry">Reintentar</button>`;
    $('#retry').onclick = admin;
  }
}

function join() {
  app.className = 'entry';
  app.innerHTML =
    header() +
    `<div class="welcome"><p>PIN de sala <strong>${esc(code)}</strong></p></div>
    <form id="join" class="join-card">
      <label>Tu nombre
        <input name="name" maxlength="30" placeholder="¿Cómo te llamas?" required autocomplete="nickname">
      </label>
      <label>Elige tu avatar</label>
      ${avatarPickerHtml()}
      <button class="primary">Entrar a la partida</button>
    </form>`;
  bindAvatarPicker();
  $('#join').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true;
    try {
      const d = await request({ op: 'join', name: e.target.elements.name.value, avatar: selectedAvatar });
      secret = d.playerToken;
      localStorage.setItem(storageKey, secret);
      poll();
    } catch (err) {
      notice(err.message);
      btn.disabled = false;
    }
  };
}

function podiumHtml(list = []) {
  if (!list.length) return '<p class="muted">Aún no hay puntajes registrados.</p>';
  const top3 = list.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  return `<div class="podium-grid">
    ${top3
      .map(
        (p, idx) => `<div class="podium-spot podium-${idx + 1}">
        <div class="podium-medal">${medals[idx] || '🏅'}</div>
        <div class="podium-avatar">${esc(p.avatar || '🎬')}</div>
        <div class="podium-name">${esc(p.name)}</div>
        <div class="podium-score">${p.score.toLocaleString('es-CL')} pts</div>
        ${p.streak >= 2 ? `<span class="streak-pill">🔥 Racha x${p.streak}</span>` : ''}
      </div>`
      )
      .join('')}
  </div>`;
}

const ranking = () => {
  const list = state.ranking || [];
  return `<section class="ranking-section">
    <h2>${state.phase === 'finished' ? '🏆 Gran Podio Final' : '📊 Tabla de Posiciones'}</h2>
    ${podiumHtml(list)}
    <div class="rank-list">
      ${list
        .map(
          p =>
            `<div class="rank">
              <span><strong>#${p.rank}</strong> ${esc(p.avatar || '🎬')} ${esc(p.name)} ${
              p.streak >= 2 ? `<small class="streak-pill">🔥 x${p.streak}</small>` : ''
            }</span>
              <strong>${p.score.toLocaleString('es-CL')} pts</strong>
            </div>`
        )
        .join('')}
    </div>
  </section>`;
};

const options = () => {
  const showStats = state.stats && ['results', 'ranking', 'finished'].includes(state.phase);
  return `<div class="options">
    ${(state.round?.options || [])
      .map((o, i) => {
        const pct = showStats ? state.stats.percents[i] || 0 : null;
        const count = showStats ? state.stats.counts[i] || 0 : null;
        const isCorrect = state.round.correct === i;
        return `<div class="option card choice-${i} ${isCorrect ? 'correct' : ''}">
          <b>${letters[i]}</b>
          <div class="option-body">
            <div class="option-text-row">
              <span>${esc(o)}${isCorrect ? ' ✓' : ''}</span>
              ${showStats ? `<small class="vote-stat">${pct}% (${count})</small>` : ''}
            </div>
            ${
              showStats
                ? `<div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%"></div></div>`
                : ''
            }
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
};

function resolveVideoSrc(rawUrl) {
  if (!rawUrl) return '';
  if (localTvVideos[rawUrl]) return localTvVideos[rawUrl];
  const baseName = rawUrl.replace(/^local:/, '');
  if (localTvVideos[baseName]) return localTvVideos[baseName];
  return rawUrl;
}

function videoStageHtml(s, cleanTv = false) {
  if (!s.round?.videoUrl) return '';
  if (!['watching', 'open', 'closed', 'results'].includes(s.phase)) return '';
  const src = resolveVideoSrc(s.round.videoUrl);
  const isMissingLocal = src.startsWith('local:');
  if (cleanTv) {
    return `<div class="video-stage tv-clean-stage">
      ${
        isMissingLocal
          ? `<div class="missing-local-video">
              <p>🎬 Preparando video (<strong>${esc(src.slice(6))}</strong>)…</p>
            </div>`
          : `<video id="round-video" src="${esc(src)}" playsinline preload="auto"></video>`
      }
    </div>`;
  }
  const badgeText =
    s.phase === 'watching'
      ? '🎬 Escena en curso · Atención al corte'
      : s.phase === 'open'
      ? '⏸️ Escena en pausa · ¡Respondan ahora!'
      : '🍿 Desenlace de la escena';
  return `<div class="video-stage card">
    <div class="video-badge">${badgeText}</div>
    ${
      isMissingLocal
        ? `<div class="missing-local-video">
            <p>🎬 Video local (<strong>${esc(src.slice(6))}</strong>).</p>
          </div>`
        : `<video id="round-video" src="${esc(src)}" playsinline preload="auto" controls></video>`
    }
  </div>`;
}

function applyVideoCommand(vs, force = false) {
  const video = $('#round-video');
  if (!video || !vs) return;
  if (!force && vs.seq === lastVideoSeq) return;
  lastVideoSeq = vs.seq;

  const stopAt = Number.isFinite(Number(vs.stopAt)) ? Number(vs.stopAt) : null;
  video.ontimeupdate = () => {
    if (stopAt !== null && video.currentTime >= stopAt) {
      video.pause();
      video.ontimeupdate = null;
    }
  };

  if (Number.isFinite(Number(vs.position))) {
    const targetPos = Number(vs.position);
    if (Math.abs(video.currentTime - targetPos) > 0.6 || force) {
      try {
        video.currentTime = targetPos;
      } catch {}
    }
  }

  if (vs.status === 'playing') {
    if (stopAt === null || video.currentTime < stopAt - 0.1) {
      video.play().catch(() => {});
    }
  } else {
    video.pause();
  }
}

function syncRoundVideo() {
  const video = $('#round-video');
  if (!video || !state?.round?.videoUrl) return;
  if (state.videoState) {
    applyVideoCommand(state.videoState, false);
  }
}

function timerBarHtml() {
  return `<div class="timer-wrap">
    <p class="timer" aria-label="Tiempo restante"></p>
    <div class="timer-progress-track"><div class="timer-progress-bar"></div></div>
  </div>`;
}

function roundBadgesHtml(s) {
  if (!s.round) return '';
  return `<div class="round-badges">
    <span class="pill">Ronda ${s.index + 1} de ${s.roundCount}</span>
    ${s.round.category ? `<span class="pill pill-gold">${esc(s.round.category)}</span>` : ''}
    ${s.round.practice ? `<span class="pill pill-practice">Ensayo · sin puntos</span>` : ''}
    ${!s.round.practice && s.settings?.speedBonus ? `<span class="pill">⚡ Bono velocidad</span>` : ''}
  </div>`;
}

function screenContent() {
  const s = state;
  if (s.phase === 'lobby') {
    return `<div class="tv-waiting-stage">
      <div class="tv-waiting-inner">
        <h1>${esc(s.title)}</h1>
        <p class="tv-pin">PIN: <strong>${esc(code)}</strong></p>
      </div>
    </div>`;
  }
  if (['watching', 'open', 'closed'].includes(s.phase)) {
    return `<div class="tv-cinema-view">
      ${videoStageHtml(s, true)}
    </div>`;
  }
  if (s.phase === 'results') {
    return `<div class="tv-cinema-view">
      ${videoStageHtml(s, true)}
      <section class="tv-answer-reveal">
        <span class="tv-answer-label">✓ RESPUESTA CORRECTA</span>
        <h2><strong>${letters[s.round.correct]}</strong> · ${esc(s.round.options[s.round.correct])}</h2>
      </section>
    </div>`;
  }
  return ranking();
}

function publicContent() {
  const s = state;
  if (role === 'screen') return screenContent();
  if (s.phase === 'lobby') {
    const lobbyPlayers = s.lobbyPlayers || [];
    return `<div class="lobby-hero">
      <h1>${esc(s.title)}</h1>
      <p class="muted">Escanea el código QR o entra en <strong>${esc(location.host)}/play</strong></p>
      <div class="lobby-pin-box">
        <div>
          <p class="code-label">PIN DE SALA</p>
          <p class="code">${esc(code)}</p>
          <p class="player-counter"><strong>${s.playerCount}</strong> ${
      s.playerCount === 1 ? 'jugador conectado' : 'jugadores conectados'
    }</p>
        </div>
        ${qr ? `<img class="qr" src="${qr}" alt="QR para ingresar a la partida">` : ''}
      </div>
      ${
        lobbyPlayers.length
          ? `<div class="player-chips">
              ${lobbyPlayers.map(p => `<span class="player-chip">${esc(p.avatar)} ${esc(p.name)}</span>`).join('')}
            </div>`
          : '<p class="muted">Esperando a que entren los primeros jugadores…</p>'
      }
    </div>`;
  }
  if (s.phase === 'watching') {
    return `${roundBadgesHtml(s)}
      <h1>👀 Mira la escena con atención</h1>
      <p class="subtitle-lead">Las alternativas se abrirán justo después del corte.</p>
      ${videoStageHtml(s)}`;
  }
  if (s.phase === 'open') {
    return `${roundBadgesHtml(s)}
      <h1>${esc(s.round.question)}</h1>
      ${timerBarHtml()}
      ${options()}
      <p class="muted"><strong>${s.received}</strong> de ${s.playerCount} respuestas recibidas</p>`;
  }
  if (s.phase === 'closed') {
    return `${roundBadgesHtml(s)}
      <h1>${esc(s.round.question)}</h1>
      ${videoStageHtml(s)}
      ${options()}
      <p class="subtitle-lead">🔒 Respuestas cerradas · Mira qué sucede después en la escena.</p>`;
  }
  if (s.phase === 'results') {
    return `${roundBadgesHtml(s)}
      <h1>${esc(s.round.question)}</h1>
      ${videoStageHtml(s)}
      ${options()}
      <section class="correct-banner">
        <h2 class="success">✓ Respuesta correcta: ${letters[s.round.correct]} · ${esc(s.round.options[s.round.correct])}</h2>
        ${
          s.stats
            ? `<p class="muted">${s.stats.correctCount} de ${s.stats.total} respuestas acertaron (${
                s.stats.percents[s.round.correct] || 0
              }%)</p>`
            : ''
        }
        ${s.round.practice ? '<p>Ronda de ensayo · sin puntos</p>' : ''}
      </section>`;
  }
  return ranking();
}

function reactionBarHtml() {
  return `<div class="reaction-bar" aria-label="Enviar reacción a la pantalla">
    ${EMOJIS.map(em => `<button type="button" class="rx-btn" data-react="${em}">${em}</button>`).join('')}
  </div>`;
}

function bindReactions() {
  document.querySelectorAll('[data-react]').forEach(btn => {
    btn.onclick = () => {
      sfx.click();
      request({ op: 'react', emoji: btn.dataset.react }).catch(() => {});
    };
  });
}

function player() {
  const s = state,
    p = s.me;
  if (!p) {
    notice('Vuelve a ingresar como jugador.');
    secret = '';
    localStorage.removeItem(storageKey);
    join();
    return;
  }
  let content = publicContent();
  if (s.phase === 'open') {
    if (p.eligible > s.index) {
      content = '<h1>Ya estás dentro</h1><p>Participarás desde la próxima ronda.</p>';
    } else if (p.answered) {
      content = `${roundBadgesHtml(s)}
        <h1>${esc(s.round.question)}</h1>
        ${options()}
        <section class="confirmed-box">
          <h2>✓ Respuesta confirmada</h2>
          <p>Elegiste <strong>${letters[p.choice]} · ${esc(s.round.options[p.choice])}</strong></p>
          <p class="muted">Mira la pantalla principal para ver el desenlace.</p>
        </section>`;
    } else {
      content = `${roundBadgesHtml(s)}
        <h1>${esc(s.round.question)}</h1>
        ${timerBarHtml()}
        <div class="options">
          ${s.round.options
            .map(
              (o, i) =>
                `<button class="option choice-${i} ${selection === i ? 'selected' : ''}" data-choice="${i}" aria-pressed="${
                  selection === i
                }" data-live>
                  <b>${letters[i]}</b>
                  <span>${esc(o)}</span>
                </button>`
            )
            .join('')}
        </div>
        <p><button id="confirm" class="primary" data-live>${
          selection === null ? 'Selecciona una alternativa' : 'Confirmar alternativa ' + letters[selection] + ' →'
        }</button></p>
        <small class="muted">Puedes cambiar tu selección antes de confirmar.</small>`;
    }
  }
  if (s.phase === 'results' && p.result) {
    const r = p.result;
    content += `<section class="personal-result ${r.correct ? 'win' : 'lose'}">
      <h2>${r.correct ? '🎉 ¡Acertaste!' : '😅 Esta vez no acertaste'}</h2>
      <p class="points-earned">+${(r.points || 0).toLocaleString('es-CL')} puntos</p>
      ${
        r.speedBonus || r.streakBonus
          ? `<p class="bonus-breakdown">Base: ${r.base || 0} ${r.speedBonus ? `· ⚡ Rapidez +${r.speedBonus}` : ''} ${
              r.streakBonus ? `· 🔥 Racha +${r.streakBonus}` : ''
            }</p>`
          : ''
      }
      ${
        p.score !== undefined
          ? `<p class="muted">Puntaje total: <strong>${p.score.toLocaleString('es-CL')} pts</strong> ${
              p.rank ? `(Puesto #${p.rank})` : ''
            }</p>`
          : ''
      }
    </section>`;
  }
  app.innerHTML =
    header() +
    `<div class="player-bar">
      <span>${esc(p.avatar || '🎬')} <strong>${esc(p.name)}</strong></span>
      ${p.streak >= 2 ? `<span class="streak-pill">🔥 Racha x${p.streak}</span>` : ''}
      ${p.score !== undefined ? `<span><strong>${p.score.toLocaleString('es-CL')} pts</strong></span>` : ''}
    </div>` +
    content +
    reactionBarHtml();

  document.querySelectorAll('[data-choice]').forEach(btn => {
    btn.onclick = () => {
      sfx.click();
      selection = Number(btn.dataset.choice);
      player();
      status();
    };
  });
  if ($('#confirm')) {
    $('#confirm').onclick = () => {
      if (selection === null) return notice('Selecciona una alternativa.');
      sfx.click();
      mutate({ op: 'answer', roundId: s.round.id, choice: selection });
    };
  }
  bindReactions();
}

const help = `<details>
  <summary>📖 Cómo cargar tus propios videos y controlarlos en vivo</summary>
  <ol>
    <li><strong>Opción A — Subir clip directo a la nube (hasta 3 MB):</strong> Al crear o editar una película, elige tu archivo <code>.mp4</code> o <code>.webm</code> y pulsa <em>"☁️ Subir clip al servidor"</em>. Quedará guardado en Upstash Redis y se reproducirá en cualquier TV o navegador automáticamente.</li>
    <li><strong>Opción B — Archivo grande local desde el Admin (sin límite de peso):</strong> Si tienes un video pesado (ej. 50 MB o 200 MB), selecciónalo aquí mismo en el Admin y pulsa <em>"💻 Guardar y usar video local"</em>. El navegador lo guardará automáticamente y la <strong>Pantalla Gigante</strong> lo reproducirá sola sin mostrar ningún botón de configuración.</li>
    <li><strong>Marcar tiempos con vista previa:</strong> Usa el reproductor de vista previa en el editor y pulsa <em>"✂️ Capturar segundo actual como Corte"</em> en el instante exacto del suspenso.</li>
    <li><strong>Control Remoto en Vivo:</strong> Durante la ronda verás la botonera <strong>🎮 Control Remoto del Video</strong> para <strong>Pausar</strong>, <strong>Continuar (Play)</strong>, <strong>Reiniciar escena (0s)</strong>, <strong>Ir al corte</strong> o <strong>Reproducir desenlace</strong> cuando tú quieras.</li>
  </ol>
</details>`;

function remoteVideoControlsHtml(s) {
  if (!s.round?.videoUrl) return '';
  const vs = s.videoState || { status: 'paused', position: 0 };
  const isPlaying = vs.status === 'playing';
  return `<div class="remote-video-box">
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <strong>🎮 Control Remoto del Video en Pantalla Gigante</strong>
      <span class="pill ${isPlaying ? 'pill-live' : 'pill-gold'}">${
    isPlaying ? '▶ Reproduciendo en TV' : '⏸ Pausado en TV'
  }</span>
    </div>
    <div class="remote-btn-grid">
      <button type="button" class="remote-btn ${!isPlaying ? 'primary-soft' : ''}" data-vcmd="${isPlaying ? 'pause' : 'play'}">
        ${isPlaying ? '⏸ Pausar video ahora' : '▶ Continuar / Reproducir'}
      </button>
      <button type="button" class="remote-btn" data-vcmd="restart">⏮ Reiniciar desde 0:00</button>
      <button type="button" class="remote-btn" data-vcmd="to-cut">✂️ Pausar en el corte (${s.round.cutTime ?? 0}s)</button>
      <button type="button" class="remote-btn" data-vcmd="play-reveal">🍿 Reproducir desenlace (desde ${s.round.cutTime ?? 0}s)</button>
    </div>
  </div>`;
}

function hostOptionsHtml(s) {
  const showStats = s.stats && s.round;
  return `<div class="options host-options-grid">
    ${(s.round?.options || [])
      .map((o, i) => {
        const pct = showStats ? s.stats.percents[i] || 0 : 0;
        const count = showStats ? s.stats.counts[i] || 0 : 0;
        const isCorrect = s.round.correct === i;
        return `<div class="option card choice-${i} ${isCorrect ? 'correct' : ''}">
          <b>${letters[i]}</b>
          <div class="option-body">
            <div class="option-text-row">
              <span>${esc(o)} ${isCorrect ? '<strong class="correct-tag">✓ CORRECTA</strong>' : ''}</span>
              <div class="host-opt-actions">
                ${showStats ? `<small class="vote-stat">${pct}% (${count})</small>` : ''}
                <button type="button" class="mark-correct-btn ${isCorrect ? 'active' : ''}" data-mark-correct="${i}" data-reveal="${
          s.phase === 'closed' || s.phase === 'results' ? '1' : '0'
        }">
                  ${isCorrect ? '✓ Es la correcta' : 'Marcar ' + letters[i] + ' como correcta'}
                </button>
              </div>
            </div>
            ${showStats ? `<div class="vote-bar-track"><div class="vote-bar-fill" style="width:${pct}%"></div></div>` : ''}
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function host() {
  app.className = 'admin host';
  const s = state;
  if (!s.rounds) {
    app.innerHTML =
      header() +
      '<h1>Acceso del organizador</h1><p>Entra para administrar esta sala.</p><a class="button-link" href="/admin.html">Entrar como organizador →</a>';
    return;
  }
  const hasNextMovie = s.index + 1 < s.roundCount;
  const action = {
    lobby: ['prepare', '🎬 Iniciar primera película / ronda'],
    watching: ['open', '🔓 Abrir alternativas para votar'],
    open: ['close', '🔒 Cerrar votación (y mostrar desenlace)'],
    closed: ['results', '✅ Indicar / Revelar respuesta correcta'],
    results: hasNextMovie ? ['prepare', '⏭️ Pasar a la siguiente película'] : ['ranking', '🏆 Mostrar gran podio final'],
    ranking: hasNextMovie ? ['prepare', '⏭️ Pasar a la siguiente película'] : ['finish', '🎉 Finalizar partida']
  }[s.phase];

  const editingRound = editingRoundId ? s.rounds.find(r => r.id === editingRoundId) : null;

  app.innerHTML =
    header() +
    `<div class="row host-top-links">
      <a href="/admin.html" class="back-link">← Mis salas</a>
      ${
        s.phase !== 'lobby'
          ? `<button type="button" id="reset-game" class="quiet">↺ Reiniciar partida al lobby</button>`
          : ''
      }
    </div>
    <h1>${esc(s.title)}</h1>
    <div class="host-pin">
      <div>
        <span class="code-label">COMPARTE ESTE PIN</span>
        <p class="code">${esc(code)}</p>
        <span>${s.playerCount} jugadores en la sala</span>
      </div>
      ${qr ? `<img class="qr" src="${qr}" alt="QR para ingresar a esta sala">` : ''}
    </div>
    <nav>
      <a href="/screen/${code}" target="_blank" rel="noopener">▣ Pantalla gigante ↗</a>
      <a href="/j/${code}" target="_blank" rel="noopener">▯ Vista Jugador ↗</a>
      <button type="button" id="copy">📋 Copiar enlace de invitación</button>
    </nav>
    <section class="director-panel">
      <div class="row" style="justify-content:space-between">
        <div class="row">
          <strong>🎛️ Control del Director en Vivo</strong>
          <span class="pill">${s.playerCount} jugadores</span>
          <span class="pill">${s.index < 0 ? 'En espera (Lobby)' : 'Película / Ronda ' + (s.index + 1) + ' de ' + s.roundCount}</span>
        </div>
        ${
          s.round
            ? `<span class="pill pill-gold">Correcta actual: Alternativa ${letters[s.round.correct]}</span>`
            : ''
        }
      </div>
      ${
        s.round
          ? `<h2>${esc(s.round.question)}</h2>
            ${remoteVideoControlsHtml(s)}
            <p class="muted" style="margin:6px 0 10px">💡 Puedes hacer clic en cualquier alternativa abajo para definirla como la <strong>Respuesta Correcta</strong> en vivo:</p>
            ${hostOptionsHtml(s)}
            <p class="muted">
              ${s.round.practice ? 'Ensayo sin puntos' : '1.000 puntos base por acierto'}
              ${!s.round.practice && s.settings?.speedBonus ? ' · ⚡ Bono rapidez activo' : ''}
              ${!s.round.practice && s.settings?.streakBonus ? ' · 🔥 Bono racha activo' : ''}
              ${s.round.videoUrl ? ` · 🎬 Video: ${esc(s.round.videoUrl)} (corte: ${s.round.cutTime ?? '-'}s)` : ''}
            </p>`
          : '<p class="muted">Prepara las películas/rondas abajo y pulsa "Iniciar primera película" para comenzar.</p>'
      }
      ${s.phase === 'watching' ? '<p class="director-hint">🎬 El video se está mostrando en la Pantalla Gigante. Pausa en el corte y abre las alternativas.</p>' : ''}
      ${s.phase === 'closed' ? '<p class="director-hint">🍿 Votación cerrada. Reproduce el desenlace del video y luego pulsa "✅ Indicar / Revelar respuesta correcta".</p>' : ''}
      ${s.phase === 'open' ? `${timerBarHtml()}<p><strong>${s.received}</strong> de ${s.playerCount} respuestas recibidas</p>` : ''}

      <div class="director-actions-bar">
        ${
          action
            ? `<button id="action" class="primary" data-live ${!s.roundCount ? 'disabled' : ''}>${action[1]}</button>`
            : ''
        }
        ${
          s.round && s.phase !== 'results'
            ? `<button type="button" id="btn-reveal-now" class="director-secondary-btn" data-live>✅ Indicar respuesta correcta ahora (${
                letters[s.round.correct]
              })</button>`
            : ''
        }
        ${
          s.round && s.phase === 'results'
            ? `<button type="button" id="btn-show-ranking" class="director-secondary-btn" data-live>🏆 Ver tabla de posiciones / Podio</button>`
            : ''
        }
        ${
          hasNextMovie && s.index >= 0 && s.phase !== 'results' && s.phase !== 'ranking'
            ? `<button type="button" id="btn-next-movie" class="director-secondary-btn" data-live>⏭️ Pasar a la siguiente película (${
                s.index + 2
              }/${s.roundCount})</button>`
            : ''
        }
      </div>
    </section>

    ${
      s.phase === 'lobby'
        ? `<section class="Templates-bar">
            <h2>📦 Banco de preguntas y plantillas rápidas</h2>
            <div class="row">
              <button type="button" data-pack="demo">🎬 + Pack Demo con Video</button>
              <button type="button" data-pack="cine">🍿 + Pack Cine (4)</button>
              <button type="button" data-pack="bloopers">😂 + Pack Virales (3)</button>
              <button type="button" id="practice">🧪 + Ronda de ensayo</button>
              <button type="button" id="export-json" class="quiet">⬇️ Exportar JSON</button>
            </div>
            <div class="checkbox-row" style="margin-top:16px">
              <label><input type="checkbox" id="opt-speed" ${s.settings?.speedBonus ? 'checked' : ''}> ⚡ Bono por rapidez (+300 máx)</label>
              <label><input type="checkbox" id="opt-streak" ${s.settings?.streakBonus ? 'checked' : ''}> 🔥 Bono por racha consecutiva</label>
            </div>
          </section>`
        : ''
    }

    <details id="editor" ${editingRound ? 'open' : ''}>
      <summary>${
        editingRound ? '✏️ Editando película / pregunta' : '➕ Añadir nueva película o pregunta'
      }</summary>
      <form id="round">
        <label>Pregunta
          <input name="question" maxlength="180" required value="${esc(
            editingRound?.question || ''
          )}" placeholder="¿Qué sucede justo después de que se abre la puerta?">
        </label>
        ${letters
          .map(
            (l, i) =>
              `<label>Alternativa ${l}
                <input name="option${i}" maxlength="80" required value="${esc(editingRound?.options?.[i] || '')}">
              </label>`
          )
          .join('')}
        <label>Respuesta Correcta
          <select name="correct">
            ${letters
              .map(
                (l, i) =>
                  `<option value="${i}" ${editingRound?.correct === i ? 'selected' : ''}>Alternativa ${l}</option>`
              )
              .join('')}
          </select>
        </label>
        <label>Segundos para responder (10–120)
          <input type="number" min="10" max="120" value="${editingRound?.seconds || 25}" name="seconds" required>
        </label>
        <label>Nombre de la película o categoría (opcional)
          <input name="category" maxlength="40" value="${esc(editingRound?.category || '')}" placeholder="Ej: Película 1, Acción, Clásicos">
        </label>
        <label style="align-self:end"><input type="checkbox" name="practice" ${
          editingRound?.practice ? 'checked' : ''
        }> Ronda de ensayo (sin puntos)</label>

        <div class="video-uploader-box" style="grid-column:1/-1">
          <h3>🎬 Cargar o vincular video para esta película</h3>
          <div class="row">
            <input type="file" id="video-file-input" accept="video/mp4,video/webm,video/quicktime" style="margin:0;flex:1">
            <button type="button" id="btn-upload-cloud" class="primary-soft">☁️ Subir clip al servidor (máx 3 MB)</button>
            <button type="button" id="btn-use-local" class="quiet">💻 Guardar y usar video local (sin límite)</button>
          </div>
          <small class="muted" id="upload-status">Puedes subir un clip a la nube, guardar un video pesado local desde aquí mismo (se verá en la TV automáticamente) o pegar un enlace directo (.mp4).</small>

          <label style="margin-top:12px">URL o ruta del video
            <input name="videoUrl" id="input-video-url" maxlength="500" value="${esc(
              editingRound?.videoUrl || ''
            )}" placeholder="/demo.mp4, /api/game?media=..., o https://...">
          </label>

          <div class="preview-stage">
            <video id="editor-preview-video" src="${esc(
              editingRound?.videoUrl ? resolveVideoSrc(editingRound.videoUrl) : '/demo.mp4'
            )}" controls preload="metadata"></video>
            <div class="row" style="margin-top:10px">
              <button type="button" id="btn-set-cut">✂️ Capturar segundo actual como Corte</button>
              <button type="button" id="btn-set-end">🏁 Capturar segundo actual como Final</button>
            </div>
          </div>

          <div class="grid" style="margin-top:12px">
            <label>Segundo de corte automático (pausa antes de responder)
              <input type="number" step="0.1" min="0" name="cutTime" id="input-cut-time" value="${
                editingRound?.cutTime ?? ''
              }" placeholder="Ej: 4.5">
            </label>
            <label>Segundo final del desenlace (opcional)
              <input type="number" step="0.1" min="0" name="endTime" id="input-end-time" value="${
                editingRound?.endTime ?? ''
              }" placeholder="Ej: 12.0">
            </label>
          </div>
        </div>

        <div class="row" style="grid-column:1/-1;margin-top:12px">
          <button class="primary">${editingRound ? 'Guardar cambios' : 'Guardar película / pregunta'}</button>
          ${editingRound ? '<button type="button" id="cancel-edit" class="quiet">Cancelar edición</button>' : ''}
        </div>
      </form>
    </details>

    <div class="row" style="justify-content:space-between;align-items:center;margin-top:26px">
      <h2 style="margin:0">Lista de películas / preguntas (${s.roundCount})</h2>
      <label class="tool-btn local-video-label" title="Pre-cargar varios archivos de video locales desde el Admin para la TV">
        📂 Cargar carpeta/archivos de video locales en Admin
        <input type="file" id="admin-batch-local-files" accept="video/*" multiple hidden>
      </label>
    </div>
    <div class="rounds-list">
      ${s.rounds
        .map(
          (q, i) =>
            `<div class="rank round-item ${s.index === i ? 'active-round-row' : ''}">
              <div>
                <strong>${i + 1}. ${esc(q.question)} ${s.index === i ? '<span class="pill pill-live">EN PANTALLA</span>' : ''}</strong>
                <div class="muted small-meta">
                  ✓ Correcta: <strong>${letters[q.correct]} (${esc(q.options[q.correct])})</strong> · ⏱️ ${q.seconds}s
                  ${q.practice ? ' · 🧪 Ensayo' : ''}
                  ${q.category ? ` · 🏷️ ${esc(q.category)}` : ''}
                  ${
                    q.videoUrl
                      ? ` · 🎬 Video (${q.cutTime !== null ? 'corte ' + q.cutTime + 's' : 'sin corte automático'})`
                      : ' · Sin video'
                  }
                </div>
              </div>
              <div class="round-actions">
                ${
                  s.index !== i
                    ? `<button type="button" class="primary-soft" data-jump="${i}" title="Ir directamente a esta película">▶ Lanzar película ${
                        i + 1
                      }</button>`
                    : ''
                }
                ${
                  s.phase === 'lobby'
                    ? `<button type="button" data-move="up" data-id="${q.id}" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
                       <button type="button" data-move="down" data-id="${q.id}" ${
                        i === s.rounds.length - 1 ? 'disabled' : ''
                      } title="Bajar">↓</button>`
                    : ''
                }
                <button type="button" data-edit="${q.id}">Editar / Video</button>
                ${s.phase === 'lobby' ? `<button type="button" data-delete="${q.id}">Eliminar</button>` : ''}
              </div>
            </div>`
        )
        .join('')}
    </div>

    ${['results', 'ranking', 'finished'].includes(s.phase) ? ranking() : ''}

    <details open>
      <summary>👥 Jugadores en la sala (${s.playerCount})</summary>
      ${
        s.players.length
          ? `<div class="host-players-grid">
              ${s.players
                .map(
                  p =>
                    `<div class="host-player-card">
                      <span>${esc(p.avatar || '🎬')} <strong>${esc(p.name)}</strong> (${p.score} pts) ${
                      p.answered ? '✅' : ''
                    }</span>
                      <button type="button" class="kick-btn" data-kick="${esc(p.id)}" title="Quitar de la sala">✕</button>
                    </div>`
                )
                .join('')}
            </div>`
          : '<p class="muted">Aún no hay jugadores conectados.</p>'
      }
    </details>
    ${help}`;

  $('#copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/j/' + code);
      notice('Enlace de invitación copiado al portapapeles.');
    } catch {
      notice(location.origin + '/j/' + code);
    }
  };
  if ($('#action'))
    $('#action').onclick = async () => {
      sfx.click();
      await mutate({ op: 'action', action: action[0], expectedPhase: s.phase, expectedIndex: s.index, force: true });
      bc?.postMessage({ type: 'refresh' });
    };
  if ($('#btn-reveal-now'))
    $('#btn-reveal-now').onclick = async () => {
      sfx.click();
      await mutate({ op: 'action', action: 'results', expectedPhase: s.phase, expectedIndex: s.index, force: true });
      bc?.postMessage({ type: 'refresh' });
    };
  if ($('#btn-show-ranking'))
    $('#btn-show-ranking').onclick = async () => {
      sfx.click();
      await mutate({ op: 'action', action: 'ranking', expectedPhase: s.phase, expectedIndex: s.index, force: true });
      bc?.postMessage({ type: 'refresh' });
    };
  if ($('#btn-next-movie'))
    $('#btn-next-movie').onclick = async () => {
      sfx.click();
      await mutate({
        op: 'action',
        action: 'prepare',
        targetIndex: s.index + 1,
        expectedPhase: s.phase,
        expectedIndex: s.index,
        force: true
      });
      bc?.postMessage({ type: 'refresh' });
    };
  document.querySelectorAll('[data-jump]').forEach(btn => {
    btn.onclick = async () => {
      sfx.click();
      const targetIndex = Number(btn.dataset.jump);
      await mutate({ op: 'action', action: 'prepare', targetIndex, expectedPhase: s.phase, expectedIndex: s.index, force: true });
      bc?.postMessage({ type: 'refresh' });
    };
  });
  document.querySelectorAll('[data-mark-correct]').forEach(btn => {
    btn.onclick = async () => {
      sfx.click();
      const correctChoice = Number(btn.dataset.markCorrect);
      const reveal = btn.dataset.reveal === '1';
      await mutate({ op: 'set-correct', roundIndex: s.index, correct: correctChoice, reveal });
      notice(`Alternativa ${letters[correctChoice]} marcada como la respuesta correcta.`);
      bc?.postMessage({ type: 'refresh' });
    };
  });
  if ($('#reset-game'))
    $('#reset-game').onclick = () => {
      if (confirm('¿Reiniciar la partida al lobby y poner los puntajes en cero?')) {
        mutate({ op: 'reset' });
      }
    };

  // Remote video control buttons
  document.querySelectorAll('[data-vcmd]').forEach(btn => {
    btn.onclick = async () => {
      sfx.click();
      const cmd = btn.dataset.vcmd;
      try {
        const res = await request({ op: 'video-control', cmd });
        if (res.videoState) {
          bc?.postMessage({ type: 'video-cmd', videoState: res.videoState });
        }
        await refresh(true);
      } catch (err) {
        notice(err.message);
      }
    };
  });

  // Video file uploader & preview bindings in Editor
  const fileInput = $('#video-file-input');
  const urlInput = $('#input-video-url');
  const previewVideo = $('#editor-preview-video');
  const statusEl = $('#upload-status');

  if (fileInput && previewVideo) {
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      await saveLocalVideoToIdb(f);
      bc?.postMessage({ type: 'local-video-updated' });
      const blobUrl = localTvVideos[f.name] || URL.createObjectURL(f);
      previewVideo.src = blobUrl;
      urlInput.value = 'local:' + f.name;
      const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
      statusEl.textContent = `✅ Video cargado en el Admin (${f.name} · ${sizeMb} MB) y listo para la Pantalla Gigante. Si deseas subirlo también a la nube (máx 3 MB), pulsa "☁️ Subir clip al servidor".`;
    };
  }
  if ($('#admin-batch-local-files')) {
    $('#admin-batch-local-files').onchange = async e => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        await saveLocalVideoToIdb(f);
      }
      bc?.postMessage({ type: 'local-video-updated' });
      notice(`✅ Se guardaron ${files.length} video(s) locales desde el Admin listos para reproducirse en la TV.`);
    };
  }
  if (urlInput && previewVideo) {
    urlInput.oninput = () => {
      const v = urlInput.value.trim();
      if (v) previewVideo.src = resolveVideoSrc(v);
    };
  }
  if ($('#btn-upload-cloud')) {
    $('#btn-upload-cloud').onclick = async () => {
      const f = fileInput?.files?.[0];
      if (!f) return notice('Primero selecciona un archivo de video (.mp4 / .webm).');
      if (f.size > 3 * 1024 * 1024) {
        return notice('El archivo supera los 3 MB para la nube, pero ya quedó guardado en modo local desde el Admin.');
      }
      const btn = $('#btn-upload-cloud');
      btn.disabled = true;
      statusEl.textContent = 'Subiendo video al servidor…';
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const str = String(reader.result || '');
            resolve(str.includes(',') ? str.split(',')[1] : str);
          };
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        const uploaded = await request({ op: 'upload-video', name: f.name, mime: f.type || 'video/mp4', data: base64 });
        urlInput.value = uploaded.videoUrl;
        previewVideo.src = uploaded.videoUrl;
        statusEl.textContent = `✅ ¡Video subido a la nube con éxito! (${uploaded.videoUrl})`;
        notice('Video subido a la nube y vinculado a la película.');
      } catch (err) {
        statusEl.textContent = '❌ Error al subir: ' + err.message;
        notice(err.message);
      } finally {
        btn.disabled = false;
      }
    };
  }
  if ($('#btn-use-local')) {
    $('#btn-use-local').onclick = async () => {
      const f = fileInput?.files?.[0];
      if (!f) return notice('Primero selecciona un archivo de video desde tu computador.');
      await saveLocalVideoToIdb(f);
      bc?.postMessage({ type: 'local-video-updated' });
      urlInput.value = 'local:' + f.name;
      statusEl.textContent = `✅ Guardado en Admin (${f.name}). La Pantalla Gigante lo reproducirá automáticamente sin pedir archivos.`;
      notice('Video local guardado en Admin y sincronizado con la TV: ' + f.name);
    };
  }
  if ($('#btn-set-cut') && previewVideo) {
    $('#btn-set-cut').onclick = () => {
      previewVideo.pause();
      const t = Math.round(previewVideo.currentTime * 10) / 10;
      $('#input-cut-time').value = t;
      notice(`Segundo de corte fijado en ${t} s.`);
    };
  }
  if ($('#btn-set-end') && previewVideo) {
    $('#btn-set-end').onclick = () => {
      previewVideo.pause();
      const t = Math.round(previewVideo.currentTime * 10) / 10;
      $('#input-end-time').value = t;
      notice(`Segundo final fijado en ${t} s.`);
    };
  }

  if ($('#round'))
    $('#round').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      const payload = {
        op: editingRoundId ? 'edit-round' : 'round',
        id: editingRoundId || undefined,
        question: f.elements.question.value,
        options: letters.map((_, i) => f.elements['option' + i].value),
        correct: Number(f.elements.correct.value),
        seconds: Number(f.elements.seconds.value),
        practice: f.elements.practice.checked,
        category: f.elements.category.value,
        videoUrl: f.elements.videoUrl.value,
        cutTime: f.elements.cutTime.value !== '' ? Number(f.elements.cutTime.value) : null,
        endTime: f.elements.endTime.value !== '' ? Number(f.elements.endTime.value) : null
      };
      editingRoundId = null;
      await mutate(payload);
    };
  if ($('#cancel-edit'))
    $('#cancel-edit').onclick = () => {
      editingRoundId = null;
      host();
      status();
    };
  if ($('#practice'))
    $('#practice').onclick = () =>
      mutate({
        op: 'round',
        question: 'Ensayo: selecciona la alternativa A.',
        options: ['Esta es la respuesta', 'Alternativa B', 'Alternativa C', 'Alternativa D'],
        correct: 0,
        seconds: 25,
        practice: true,
        category: 'Ensayo'
      });
  document.querySelectorAll('[data-pack]').forEach(btn => {
    btn.onclick = () => mutate({ op: 'template', pack: btn.dataset.pack });
  });
  if ($('#export-json')) {
    $('#export-json').onclick = () => {
      const blob = new Blob([JSON.stringify(s.rounds, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `preguntas-${code}.json`;
      a.click();
    };
  }
  const bindSettings = () => {
    const speedEl = $('#opt-speed'),
      streakEl = $('#opt-streak');
    if (speedEl && streakEl) {
      const save = () => mutate({ op: 'settings', speedBonus: speedEl.checked, streakBonus: streakEl.checked });
      speedEl.onchange = save;
      streakEl.onchange = save;
    }
  };
  bindSettings();
  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.onclick = () => mutate({ op: 'delete', id: btn.dataset.delete });
  });
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => {
      editingRoundId = btn.dataset.edit;
      host();
      status();
      $('#editor')?.scrollIntoView({ behavior: 'smooth' });
    };
  });
  document.querySelectorAll('[data-move]').forEach(btn => {
    btn.onclick = () => mutate({ op: 'move-round', id: btn.dataset.id, dir: btn.dataset.move });
  });
  document.querySelectorAll('[data-kick]').forEach(btn => {
    btn.onclick = () => mutate({ op: 'kick', playerId: btn.dataset.kick });
  });
}

async function mutate(body) {
  if (busy || !online) return;
  busy = true;
  status();
  try {
    await request(body);
    viewKey = '';
    await refresh(true);
  } catch (e) {
    notice(e.message);
  } finally {
    busy = false;
    status();
  }
}

function handlePhaseEffects(s) {
  if (!s) return;
  if (s.phase !== lastPhase) {
    if (lastPhase !== '') {
      if (s.phase === 'open') sfx.open();
      else if (s.phase === 'closed') sfx.close();
      else if (s.phase === 'results') {
        sfx.reveal();
        if (role === 'screen' || (role === 'player' && s.me?.result?.correct)) launchConfetti();
      } else if (s.phase === 'ranking' || s.phase === 'finished') {
        sfx.podium();
        if (s.phase === 'finished') launchConfetti();
      }
    }
    lastPhase = s.phase;
  }
  if (s.reactions) spawnReactions(s.reactions);
}

function render() {
  if (role === 'host') host();
  else if (role === 'player') player();
  else {
    app.className = 'screen';
    app.innerHTML = header() + publicContent();
  }
  syncRoundVideo();
  status();
}

async function refresh(force = false) {
  const started = Date.now(),
    s = await request();
  offset = s.serverNow - (started + Date.now()) / 2;
  online = true;
  state = s;
  if (s.round?.id !== lastRound) {
    lastRound = s.round?.id;
    selection = null;
    lastVideoSeq = -1;
  }
  handlePhaseEffects(s);
  const key = JSON.stringify({ ...s, serverNow: 0, reactions: [], videoState: role === 'host' ? s.videoState : null });
  const editing = role === 'host' && $('#editor')?.open;
  if ((key !== viewKey && !editing) || force) {
    viewKey = key;
    render();
  } else {
    syncRoundVideo();
  }
  status();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    await refresh();
  } catch (e) {
    online = false;
    status();
    notice(e.message);
    if (!state)
      app.innerHTML = header() + `<h1>No pudimos conectar</h1><p>${esc(e.message)}</p><p>Volveremos a intentarlo automáticamente.</p>`;
  } finally {
    polling = false;
    setTimeout(poll, 1800);
  }
}

setInterval(() => {
  const el = $('.timer');
  const bar = $('.timer-progress-bar');
  if (el && state?.deadline) {
    const remainingMs = Math.max(0, state.deadline - Date.now() - offset);
    const left = Math.ceil(remainingMs / 1000);
    el.textContent = left + ' s';
    el.classList.toggle('urgent', left <= 5);
    if (bar && state.round?.seconds) {
      const pct = Math.max(0, Math.min(100, (remainingMs / (state.round.seconds * 1000)) * 100));
      bar.style.width = pct + '%';
      bar.classList.toggle('urgent', left <= 5);
    }
    if (left !== lastTickSecond && left > 0 && left <= 10) {
      lastTickSecond = left;
      sfx.tick(left <= 5);
    }
    if (left === 0) {
      document.querySelectorAll('[data-choice],#confirm').forEach(x => (x.disabled = true));
    }
  }
}, 200);

if (role === 'home') home();
else if (role === 'entry') playerEntry();
else if (role === 'tv') tvEntry();
else if (role === 'admin') admin();
else if (role === 'player' && !secret) join();
else {
  app.innerHTML = header() + '<p>Conectando…</p>';
  poll();
}

if (role === 'screen' || role === 'host') {
  request({ op: 'qr', origin: location.origin })
    .then(d => {
      qr = d.image;
      viewKey = '';
    })
    .catch(() => {});
}
