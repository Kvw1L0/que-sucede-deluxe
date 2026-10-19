import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handler } from '../api/game.mjs';
import { MemoryStore, RedisStore } from '../cloud/store.mjs';
import { round, advance, answer, snapshot } from '../cloud/game.mjs';
import { adminSession, setAdminCookie } from '../cloud/admin.mjs';

const definition = { question: '¿Qué sucede?', options: ['Salta', 'Corre', 'Gira', 'Cae'], correct: 0, seconds: 25 };

test('validación: cuatro opciones, tiempo accesible y una respuesta correcta', () => {
  for (const change of [{ options: ['A', 'B', 'C'] }, { options: ['A', 'a', 'B', 'C'] }, { seconds: 5 }, { correct: 4 }]) {
    assert.throws(() => round({ ...definition, ...change }));
  }
  assert.equal(round(definition).seconds, 25);
});

test('apertura manual, límite exacto, ensayo sin puntos, estadísticas y bonos opcionales', () => {
  const r = {
    phase: 'lobby',
    index: -1,
    rounds: [round({ ...definition, practice: true }), round(definition)],
    players: [
      { id: 'a', name: 'Ana', score: 0, streak: 0, eligible: 0 },
      { id: 'b', name: 'Beto', score: 0, streak: 0, eligible: 0 }
    ],
    answers: {}
  };
  assert.throws(() => advance(r, 'open', 0));
  advance(r, 'prepare', 0);
  assert.equal(r.phase, 'watching');
  advance(r, 'open', 100);
  answer(r, r.players[0], { roundId: r.rounds[0].id, choice: 0 }, 101);
  assert.equal(r.players[0].score, 0);
  assert.throws(() => answer(r, r.players[1], { roundId: r.rounds[0].id, choice: 0 }, 25100));
  advance(r, 'results', 25100);
  advance(r, 'ranking', 25100);
  advance(r, 'prepare', 25100);
  advance(r, 'open', 26000);
  answer(r, r.players[0], { roundId: r.rounds[1].id, choice: 0 }, 26001);
  answer(r, r.players[1], { roundId: r.rounds[1].id, choice: 0 }, 50999);
  assert.equal(r.players[0].score, r.players[1].score);
  assert.equal(r.players[0].score, 1000);
  const hidden = snapshot(r, 'player', r.players[0], 30000);
  assert.equal(hidden.round.correct, undefined);
  assert.equal(hidden.me.score, undefined);
  assert.equal(hidden.ranking, undefined);
  advance(r, 'results', 51000);
  const pubSnap = snapshot(r, 'screen', null, 51000);
  assert.deepEqual(pubSnap.ranking.map(p => p.rank), [1, 1]);
  assert.deepEqual(pubSnap.stats.counts, [2, 0, 0, 0]);
  assert.equal(pubSnap.stats.percents[0], 100);
});

test('HTTP: 50 jugadores simultáneos, privacidad, plantillas, reacciones e ingreso tardío', async t => {
  const db = new MemoryStore(),
    server = http.createServer(handler(db, { HOST_KEY: 'test-secret' }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  async function call(b, token) {
    const res = await fetch(origin + '/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(b)
    });
    return { status: res.status, ...(await res.json()) };
  }
  const fail = await call({ op: 'create', title: 'Test', key: 'bad' });
  assert.equal(fail.status, 403);
  const created = await call({ op: 'create', title: 'Test', key: 'test-secret' }),
    { code, hostToken } = created;
  assert.equal(created.status, 200);
  await call({ op: 'round', code, ...definition }, hostToken);
  const joined = await Promise.all(Array.from({ length: 50 }, (_, i) => call({ op: 'join', code, name: 'Jugador ' + i, avatar: '🍿' })));
  assert.ok(joined.every(x => x.status === 200));
  async function state(token) {
    const res = await fetch(origin + '/api/game?code=' + code, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    return res.json();
  }
  const publicState = await state();
  assert.equal(publicState.playerCount, 50);
  assert.equal(publicState.rounds, undefined);
  assert.equal(publicState.hostHash, undefined);
  assert.equal((await call({ op: 'round', code, ...definition }, joined[0].playerToken)).status, 403);
  assert.equal((await call({ op: 'action', code, action: 'prepare', expectedPhase: 'lobby', expectedIndex: -1 }, hostToken)).status, 200);
  assert.equal((await call({ op: 'action', code, action: 'prepare', expectedPhase: 'lobby', expectedIndex: -1 }, hostToken)).status, 409);
  assert.equal((await state()).round.options, undefined);
  await call({ op: 'action', code, action: 'open', expectedPhase: 'watching', expectedIndex: 0 }, hostToken);
  const s = await state(),
    rid = s.round.id;
  const late = await call({ op: 'join', code, name: 'Llegó tarde' });
  assert.equal((await call({ op: 'answer', code, roundId: rid, choice: 0 }, late.playerToken)).status, 409);
  const sent = await Promise.all(joined.map(x => call({ op: 'answer', code, roundId: rid, choice: 0 }, x.playerToken)));
  assert.ok(sent.every(x => x.status === 200));
  assert.equal((await call({ op: 'answer', code, roundId: rid, choice: 0 }, joined[0].playerToken)).status, 200);
  assert.equal((await call({ op: 'answer', code, roundId: rid, choice: 1 }, joined[0].playerToken)).status, 409);
  assert.equal((await state(joined[0].playerToken)).me.answered, true);
  assert.equal((await state()).round.correct, undefined);
  assert.equal((await call({ op: 'react', code, emoji: '🔥' }, joined[0].playerToken)).status, 200);
  await call({ op: 'action', code, action: 'close', expectedPhase: 'open', expectedIndex: 0 }, hostToken);
  await call({ op: 'action', code, action: 'results', expectedPhase: 'closed', expectedIndex: 0 }, hostToken);
  const final = await state(joined[0].playerToken);
  assert.equal(final.me.score, 1000);
  assert.equal(final.ranking.filter(p => p.rank === 1).length, 50);
});

test('Vercel sin Redis informa configuración pendiente, sin SQLite ni caída opaca', async () => {
  const db = new RedisStore({});
  await assert.rejects(
    () => db.read('ABCDEF'),
    e => e.status === 503 && e.message.includes('Upstash')
  );
});

test('sesión de organización: crear varias salas sin clave, PIN numérico y permisos separados', async t => {
  const db = new MemoryStore(),
    env = { HOST_KEY: 'private-test-key' },
    server = http.createServer(handler(db, env));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  async function post(b, useCookie = true) {
    const res = await fetch(base + '/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(useCookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(b)
    });
    return { res, data: await res.json() };
  }
  assert.equal((await post({ op: 'create', title: 'Sin acceso' })).res.status, 403);
  const login = await post({ op: 'login', key: env.HOST_KEY });
  assert.equal(login.res.status, 200);
  cookie = login.res.headers.get('set-cookie').split(';')[0];
  assert.match(login.res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await post({ op: 'admin-status' })).data.authenticated, true);
  const one = (await post({ op: 'create', title: 'Sala uno', template: 'demo' })).data,
    two = (await post({ op: 'create', title: 'Sala dos' })).data;
  assert.match(one.code, /^\d{6}$/);
  assert.notEqual(one.code, two.code);
  const privateState = await fetch(base + '/api/game?code=' + one.code + '&view=host', { headers: { Cookie: cookie } });
  assert.equal((await privateState.json()).rounds.length, 2);
});

test('la sesión rechaza firmas alteradas, expiración y cambio de clave', () => {
  let value;
  setAdminCookie({ setHeader: (_, v) => (value = v) }, 'secret', true);
  const req = { headers: { cookie: value.split(';')[0] } };
  assert.equal(adminSession(req, 'secret'), true);
  assert.equal(adminSession(req, 'changed'), false);
  assert.equal(adminSession(req, 'secret', Date.now() + 31 * 86400000), false);
  assert.match(value, /Secure/);
});

test('carga de video y control remoto (Play, Pausa, Corte, Desenlace) desde el administrador', async t => {
  const db = new MemoryStore(),
    env = { HOST_KEY: 'video-secret' },
    server = http.createServer(handler(db, env));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;

  async function call(b, token) {
    const res = await fetch(base + '/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(b)
    });
    return { status: res.status, ...(await res.json()) };
  }

  const { code, hostToken } = await call({ op: 'create', title: 'Sala Video', key: 'video-secret' });
  const fakeVideoBase64 = Buffer.from('fake-mp4-binary-content').toString('base64');
  const up = await call({ op: 'upload-video', code, name: 'escena.mp4', mime: 'video/mp4', data: fakeVideoBase64 }, hostToken);
  assert.equal(up.status, 200);
  assert.match(up.videoUrl, /^\/api\/game\?media=/);

  const mediaRes = await fetch(base + up.videoUrl);
  assert.equal(mediaRes.status, 200);
  assert.equal(mediaRes.headers.get('content-type'), 'video/mp4');
  assert.equal(await mediaRes.text(), 'fake-mp4-binary-content');

  await call({ op: 'round', code, ...definition, videoUrl: up.videoUrl, cutTime: 3.5, endTime: 8.0 }, hostToken);
  await call({ op: 'action', code, action: 'prepare', expectedPhase: 'lobby', expectedIndex: -1 }, hostToken);

  const pauseRes = await call({ op: 'video-control', code, cmd: 'pause' }, hostToken);
  assert.equal(pauseRes.status, 200);
  assert.equal(pauseRes.videoState.status, 'paused');

  const playRes = await call({ op: 'video-control', code, cmd: 'play' }, hostToken);
  assert.equal(playRes.videoState.status, 'playing');

  const cutRes = await call({ op: 'video-control', code, cmd: 'to-cut' }, hostToken);
  assert.equal(cutRes.videoState.status, 'paused');
  assert.equal(cutRes.videoState.position, 3.5);

  const revRes = await call({ op: 'video-control', code, cmd: 'play-reveal' }, hostToken);
  assert.equal(revRes.videoState.status, 'playing');
  assert.equal(revRes.videoState.position, 3.5);
  assert.equal(revRes.videoState.stopAt, 8.0);

  // Add a second movie and test live set-correct + direct jump to next movie
  await call({ op: 'round', code, ...definition, question: 'Segunda película' }, hostToken);
  const markRes = await call({ op: 'set-correct', code, roundIndex: 0, correct: 2, reveal: true }, hostToken);
  assert.equal(markRes.status, 200);

  const jumpRes = await call({ op: 'action', code, action: 'prepare', targetIndex: 1, force: true }, hostToken);
  assert.equal(jumpRes.status, 200);
});

