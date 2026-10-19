import { token, hash, check, round, advance, answer, snapshot, QUESTION_TEMPLATES } from '../cloud/game.mjs';
import { RedisStore, update } from '../cloud/store.mjs';
import QRCode from 'qrcode';
import { adminSession, setAdminCookie } from '../cloud/admin.mjs';
import { randomInt } from 'node:crypto';

const store = new RedisStore();

const ALLOWED_AVATARS = ['🎬', '🍿', '🎭', '🌟', '🦊', '🦁', '🐼', '🐯', '🐸', '🐙', '🦄', '🚀', '⚡', '🎸', '🕵️', '👑'];
const ALLOWED_EMOJIS = ['👏', '😂', '😱', '🔥', '🎉', '🤔', '❤️', '🍿'];

export function handler(db = store, env = process.env) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    try {
      check(['GET', 'POST'].includes(req.method), 'Método no permitido.', 405);
      const url = new URL(req.url, 'http://localhost');
      let b = {};
      if (req.method === 'POST') {
        check((req.headers['content-type'] || '').includes('application/json'), 'Envía JSON.', 415);
        if (req.body) {
          b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            check(Buffer.byteLength(raw) <= 64000, 'Solicitud demasiado grande.', 413);
          }
          b = JSON.parse(raw || '{}');
        }
        check(b && typeof b === 'object', 'Solicitud inválida.', 400);
      }

      const hostKey = env === process.env ? (env.HOST_KEY || 'deluxe') : env.HOST_KEY;
      const op = req.method === 'GET' ? 'state' : b.op;
      const isAdmin = adminSession(req, hostKey);
      const secure = !!env.VERCEL || req.headers['x-forwarded-proto'] === 'https';

      if (op === 'admin-status') return send(200, { authenticated: isAdmin });

      if (op === 'login') {
        check(hostKey, 'Falta configurar el acceso de organización.', 503);
        check(typeof b.key === 'string' && hash(b.key) === hash(hostKey), 'Clave incorrecta.', 403);
        setAdminCookie(res, hostKey, secure);
        return send(200, { ok: true });
      }

      if (op === 'logout') {
        setAdminCookie(res, hostKey || 'unused', secure, true);
        return send(200, { ok: true });
      }

      if (op === 'create') {
        check(hostKey, 'Configura HOST_KEY en Vercel para crear partidas.', 503);
        check(
          isAdmin || (typeof b.key === 'string' && hash(b.key) === hash(hostKey)),
          'Abre el acceso de administrador para crear salas.',
          403
        );
        check(typeof b.title === 'string' && b.title.trim() && b.title.length <= 80, 'Escribe un nombre de partida.', 400);
        const hostToken = token();
        const initialRounds = [];
        if (b.template && QUESTION_TEMPLATES[b.template]) {
          for (const item of QUESTION_TEMPLATES[b.template].rounds) {
            initialRounds.push(round(item));
          }
        }
        for (let i = 0; i < 8; i++) {
          const code = String(randomInt(0, 1000000)).padStart(6, '0');
          const r = {
            code,
            title: b.title.trim(),
            hostHash: hash(hostToken),
            phase: 'lobby',
            index: -1,
            rounds: initialRounds,
            players: [],
            answers: {},
            reactions: [],
            settings: {
              speedBonus: b.speedBonus === true,
              streakBonus: b.streakBonus === true
            }
          };
          if (await db.create(code, JSON.stringify(r))) return send(200, { code, hostToken });
        }
        check(false, 'Intenta crear la sala otra vez.', 503);
      }

      const code = url.searchParams.get('code') || b.code;
      check(/^(?:[0-9]{6}|[A-Z2-9]{6})$/.test(code || ''), 'Revisa el PIN de la sala.', 400);
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');

      const identify = r => {
        if (
          isAdmin &&
          ((req.method === 'GET' && url.searchParams.get('view') === 'host') ||
            ['round', 'edit-round', 'move-round', 'template', 'import', 'settings', 'reset', 'kick', 'delete', 'action'].includes(op))
        ) {
          return { role: 'host' };
        }
        if (bearer && hash(bearer) === r.hostHash) return { role: 'host' };
        const p = bearer && r.players.find(p => p.secret === hash(bearer));
        if (p) return { role: 'player', p };
        check(!bearer, 'Sesión no válida. Vuelve a ingresar.', 401);
        return { role: 'screen' };
      };

      if (op === 'state') {
        const raw = await db.read(code);
        check(raw, 'Sala no encontrada o caducada.', 404);
        const r = JSON.parse(raw);
        const { role, p } = identify(r);
        return send(200, snapshot(r, role, p, Date.now()));
      }

      if (op === 'qr') {
        const raw = await db.read(code);
        check(raw, 'Sala no encontrada.', 404);
        check(typeof b.origin === 'string' && /^https?:\/\//.test(b.origin), 'Dirección inválida.', 400);
        return send(200, { image: await QRCode.toDataURL(new URL('/j/' + code, b.origin).href, { width: 300, margin: 2 }) });
      }

      const newToken = token();
      const result = await update(db, code, r => {
        if (op === 'join') {
          check(r.phase !== 'finished', 'La partida terminó.');
          check(r.players.length < 100, 'La sala está completa.');
          check(typeof b.name === 'string' && b.name.trim() && b.name.length <= 30, 'Escribe un nombre de hasta 30 caracteres.', 400);
          check(
            !r.players.some(p => p.name.toLocaleLowerCase() === b.name.trim().toLocaleLowerCase()),
            'Ese nombre ya está en uso.'
          );
          const avatar = ALLOWED_AVATARS.includes(b.avatar)
            ? b.avatar
            : ALLOWED_AVATARS[r.players.length % ALLOWED_AVATARS.length];
          r.players.push({
            id: newToken.slice(0, 12),
            secret: hash(newToken),
            name: b.name.trim(),
            avatar,
            score: 0,
            streak: 0,
            eligible: r.phase === 'lobby' ? 0 : r.index + 1
          });
          return { playerToken: newToken };
        }

        const { role, p } = identify(r);

        if (op === 'answer') {
          check(role === 'player', 'Ingresa como jugador.', 403);
          answer(r, p, b, Date.now());
          return { ok: true };
        }

        if (op === 'react') {
          check(role === 'player', 'Ingresa como jugador.', 403);
          const emoji = ALLOWED_EMOJIS.includes(b.emoji) ? b.emoji : '👏';
          const now = Date.now();
          r.reactions = (r.reactions || []).filter(rx => now - rx.at < 8000).slice(-24);
          r.reactions.push({
            id: token().slice(0, 8),
            emoji,
            name: p.name,
            avatar: p.avatar || '🎬',
            at: now
          });
          return { ok: true };
        }

        check(role === 'host', 'Solo el administrador puede realizar esta acción.', 403);

        if (op === 'round') {
          check(r.phase === 'lobby', 'Las preguntas se preparan antes de empezar.');
          check(r.rounds.length < 30, 'Máximo 30 rondas.');
          r.rounds.push(round(b));
        } else if (op === 'edit-round') {
          check(r.phase === 'lobby', 'Las preguntas se editan antes de empezar.');
          const idx = r.rounds.findIndex(q => q.id === b.id);
          check(idx >= 0, 'Pregunta no encontrada.', 404);
          r.rounds[idx] = round({ ...b, id: b.id });
        } else if (op === 'move-round') {
          check(r.phase === 'lobby', 'Las preguntas se ordenan antes de empezar.');
          const idx = r.rounds.findIndex(q => q.id === b.id);
          check(idx >= 0, 'Pregunta no encontrada.', 404);
          const target = b.dir === 'up' ? idx - 1 : idx + 1;
          if (target >= 0 && target < r.rounds.length) {
            const tmp = r.rounds[idx];
            r.rounds[idx] = r.rounds[target];
            r.rounds[target] = tmp;
          }
        } else if (op === 'template') {
          check(r.phase === 'lobby', 'Las plantillas se cargan antes de empezar.');
          const pack = QUESTION_TEMPLATES[b.pack];
          check(pack, 'Plantilla no encontrada.', 400);
          for (const item of pack.rounds) {
            if (r.rounds.length < 30) r.rounds.push(round(item));
          }
        } else if (op === 'import') {
          check(r.phase === 'lobby', 'Las preguntas se importan antes de empezar.');
          check(Array.isArray(b.rounds) && b.rounds.length > 0, 'Envía una lista de preguntas válida.', 400);
          for (const item of b.rounds) {
            if (r.rounds.length < 30) r.rounds.push(round(item));
          }
        } else if (op === 'settings') {
          r.settings = {
            speedBonus: b.speedBonus === true,
            streakBonus: b.streakBonus === true
          };
        } else if (op === 'delete') {
          check(r.phase === 'lobby', 'La partida ya comenzó.');
          r.rounds = r.rounds.filter(q => q.id !== b.id);
        } else if (op === 'kick') {
          r.players = r.players.filter(pl => pl.id !== b.playerId && pl.name !== b.name);
        } else if (op === 'reset') {
          r.phase = 'lobby';
          r.index = -1;
          r.answers = {};
          r.reactions = [];
          r.deadline = null;
          for (const pl of r.players) {
            pl.score = 0;
            pl.streak = 0;
            pl.eligible = 0;
          }
        } else if (op === 'action') {
          check(
            (r.phase === b.expectedPhase && r.index === b.expectedIndex) ||
              (r.phase === 'open' && Date.now() >= r.deadline && b.expectedPhase === 'closed' && r.index === b.expectedIndex),
            'La partida cambió. Revisa su estado.'
          );
          advance(r, b.action, Date.now());
        } else {
          check(false, 'Operación desconocida.', 400);
        }
        return { ok: true };
      });
      send(200, result);
    } catch (e) {
      send(e.status || 500, { error: e.status ? e.message : 'No se pudo completar la operación. Intenta otra vez.' });
    }
  };
}

export default handler();
