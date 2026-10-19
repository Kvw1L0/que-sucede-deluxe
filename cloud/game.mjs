import { randomBytes, createHash } from 'node:crypto';

export const token = () => randomBytes(24).toString('base64url');
export const hash = s => createHash('sha256').update(s || '').digest('hex');

export function check(ok, message, status = 409) {
  if (!ok) throw Object.assign(new Error(message), { status });
}

export const QUESTION_TEMPLATES = {
  demo: {
    label: '🎬 Pack Demo con Video Integrado',
    rounds: [
      {
        question: 'Ensayo: ¿Qué sucede justo después del corte en la escena de demostración?',
        options: ['La figura dorada salta y aterriza en el centro', 'Se apagan las luces del escenario', 'Cae una cortina roja', 'Aparece un cartel de Fin'],
        correct: 0,
        seconds: 25,
        practice: true,
        videoUrl: '/demo.mp4',
        cutTime: 2.2,
        endTime: 5.0,
        category: 'Ensayo · Video'
      },
      {
        question: 'En la escena clásica del pastel y el camarero apresurado, ¿qué sucede después de que tropieza con la alfombra?',
        options: ['Hace malabares y salva el pastel intacto', 'El pastel cae sobre la mesa principal', 'Otro camarero lo atrapa en el aire', 'Se resbala pero cae sentado con la bandeja'],
        correct: 0,
        seconds: 25,
        practice: false,
        videoUrl: '/demo.mp4',
        cutTime: 2.2,
        endTime: 5.0,
        category: 'Comedia Física'
      }
    ]
  },
  cine: {
    label: '🍿 Pack Momentos Inesperados del Cine',
    rounds: [
      {
        question: 'El héroe corta el cable azul de la bomba cuando el reloj marca 0:01… ¿qué sucede después?',
        options: ['El contador se detiene pero suena la alarma del microondas', 'La bomba explota en confeti de colores', 'El temporizador reinicia a 60 segundos', 'Se abre una compuerta secreta en el piso'],
        correct: 0,
        seconds: 25,
        practice: false,
        category: 'Acción y Suspenso'
      },
      {
        question: 'Durante la persecución en autos por el mercado de frutas, ¿qué sucede cuando el conductor gira a la izquierda?',
        options: ['Cruza un camión con colchones y amortigua el salto', 'Choca contra una torre de sandías gigantes', 'Entra por accidente a un desfile escolar', 'Se queda sin gasolina frente a la comisaría'],
        correct: 1,
        seconds: 25,
        practice: false,
        category: 'Escenas de Acción'
      },
      {
        question: 'En la cena romántica a la luz de las velas, el protagonista intenta mostrar el anillo escondido en el postre… ¿qué sucede después?',
        options: ['El violín toca tan fuerte que se rompe una copa', 'El perro de la casa salta y se come el postre sin el anillo', 'El mesero se lleva el plato pensando que ya terminaron', 'Se activa el rociador contra incendios sobre la mesa'],
        correct: 2,
        seconds: 25,
        practice: false,
        category: 'Comedia Romántica'
      },
      {
        question: 'El explorador toma el ídolo dorado del pedestal y lo reemplaza con una bolsa de arena… ¿qué sucede después?',
        options: ['El pedestal baja lentamente y activa una roca gigante', 'El techo se abre dejando caer lluvia tropical', 'Se encienden antorchas mágicas en todo el templo', 'El ídolo resulta ser una réplica de chocolate'],
        correct: 0,
        seconds: 25,
        practice: false,
        category: 'Aventura Clásica'
      }
    ]
  },
  bloopers: {
    label: '😂 Pack Bloopers y Videos Virales',
    rounds: [
      {
        question: 'Un gato observa fijamente un vaso de agua al borde de la mesa mientras su dueño le dice "¡No lo hagas!"… ¿qué sucede después?',
        options: ['Mira a la cámara y empuja el vaso con una pata lentamente', 'Se da media vuelta y se duerme sobre el teclado', 'Toma agua del vaso sin botarlo', 'Salta a la repisa superior y cae una planta'],
        correct: 0,
        seconds: 25,
        practice: false,
        category: 'Mascotas'
      },
      {
        question: 'El reportero en vivo intenta entrevistar a un campeón de skate en la rampa… ¿qué sucede después?',
        options: ['El micrófono sale volando y lo atrapa un espectador', 'El reportero pisa una patineta y desliza con estilo sin caerse', 'Un perro entra en patineta cruzando toda la toma', 'Empieza a llover de golpe y se corta la señal'],
        correct: 2,
        seconds: 25,
        practice: false,
        category: 'TV en Vivo'
      },
      {
        question: 'Al soplar las velas del cumpleaños número 80 con toda la familia cantando… ¿qué sucede después?',
        options: ['Son velas mágicas que se vuelven a encender solas', 'El abuelo apaga todas de un solo soplido y celebra como futbolista', 'El humo activa la alarma de cocina', 'Un nieto se adelanta y sopla primero'],
        correct: 1,
        seconds: 25,
        practice: false,
        category: 'Familia y Fiestas'
      }
    ]
  }
};

export function round(input) {
  check(
    typeof input.question === 'string' && input.question.trim() && input.question.length <= 180,
    'Escribe una pregunta de hasta 180 caracteres.',
    400
  );
  check(
    Array.isArray(input.options) &&
      input.options.length === 4 &&
      input.options.every(x => typeof x === 'string' && x.trim() && x.length <= 80),
    'Escribe cuatro alternativas.',
    400
  );
  check(
    new Set(input.options.map(x => x.trim().toLowerCase())).size === 4,
    'Las alternativas deben ser distintas.',
    400
  );
  check(
    Number.isInteger(input.correct) && input.correct >= 0 && input.correct < 4,
    'Selecciona la respuesta correcta.',
    400
  );
  check(
    Number.isInteger(input.seconds) && input.seconds >= 10 && input.seconds <= 120,
    'Usa entre 10 y 120 segundos.',
    400
  );

  const videoUrl = typeof input.videoUrl === 'string' ? input.videoUrl.trim().slice(0, 500) : '';
  const cutTime =
    input.cutTime !== null && input.cutTime !== '' && Number.isFinite(Number(input.cutTime)) && Number(input.cutTime) >= 0
      ? Number(input.cutTime)
      : null;
  const endTime =
    input.endTime !== null && input.endTime !== '' && Number.isFinite(Number(input.endTime)) && Number(input.endTime) > 0
      ? Number(input.endTime)
      : null;
  const category = typeof input.category === 'string' ? input.category.trim().slice(0, 40) : '';

  return {
    id: input.id && typeof input.id === 'string' ? input.id : token(),
    question: input.question.trim(),
    options: input.options.map(x => x.trim()),
    correct: input.correct,
    seconds: input.seconds,
    practice: input.practice === true,
    videoUrl,
    cutTime,
    endTime,
    category
  };
}

export function phase(r, now) {
  return r.phase === 'open' && now >= r.deadline ? 'closed' : r.phase;
}

export function advance(r, action, now) {
  r.phase = phase(r, now);
  const is = (...states) => check(states.includes(r.phase), 'La partida cambió. Actualiza antes de continuar.');
  if (action === 'prepare') {
    is('lobby', 'ranking');
    check(r.index + 1 < r.rounds.length, 'No hay más preguntas.');
    r.index++;
    r.phase = 'watching';
    r.phaseStartedAt = now;
    const q = r.rounds[r.index];
    r.videoState = {
      status: 'playing',
      position: 0,
      stopAt: q?.cutTime ?? null,
      seq: (r.videoState?.seq || 0) + 1,
      updatedAt: now
    };
  } else if (action === 'open') {
    is('watching');
    r.phase = 'open';
    r.openedAt = now;
    r.deadline = now + r.rounds[r.index].seconds * 1000;
    const q = r.rounds[r.index];
    r.videoState = {
      status: 'paused',
      position: q?.cutTime ?? r.videoState?.position ?? 0,
      stopAt: q?.cutTime ?? null,
      seq: (r.videoState?.seq || 0) + 1,
      updatedAt: now
    };
  } else if (action === 'close') {
    is('open');
    r.phase = 'closed';
    r.closedAt = now;
    const q = r.rounds[r.index];
    r.videoState = {
      status: 'playing',
      position: q?.cutTime ?? 0,
      stopAt: q?.endTime ?? null,
      seq: (r.videoState?.seq || 0) + 1,
      updatedAt: now
    };
  } else if (action === 'results') {
    is('closed');
    r.phase = 'results';
    r.resultsAt = now;
  } else if (action === 'ranking') {
    is('results');
    r.phase = 'ranking';
  } else if (action === 'finish') {
    is('ranking');
    r.phase = 'finished';
  } else {
    check(false, 'Acción desconocida.', 400);
  }
}

export function controlVideo(r, b, now) {
  const q = r.rounds[r.index];
  check(q, 'Primero prepara una ronda para controlar el video.');
  const vs = r.videoState || { status: 'paused', position: 0, stopAt: q.cutTime ?? null, seq: 0, updatedAt: now };
  const cmd = b.cmd;
  if (cmd === 'play') {
    vs.status = 'playing';
    if (Number.isFinite(Number(b.position))) vs.position = Math.max(0, Number(b.position));
    if (b.stopAt !== undefined) vs.stopAt = Number.isFinite(Number(b.stopAt)) ? Number(b.stopAt) : null;
  } else if (cmd === 'pause') {
    vs.status = 'paused';
    if (Number.isFinite(Number(b.position))) vs.position = Math.max(0, Number(b.position));
  } else if (cmd === 'restart') {
    vs.status = 'playing';
    vs.position = 0;
    vs.stopAt = q.cutTime ?? null;
  } else if (cmd === 'to-cut') {
    vs.status = 'paused';
    vs.position = q.cutTime ?? 0;
    vs.stopAt = q.cutTime ?? null;
  } else if (cmd === 'play-reveal') {
    vs.status = 'playing';
    vs.position = q.cutTime ?? 0;
    vs.stopAt = q.endTime ?? null;
  } else if (cmd === 'seek') {
    if (Number.isFinite(Number(b.position))) vs.position = Math.max(0, Number(b.position));
    if (b.status === 'playing' || b.status === 'paused') vs.status = b.status;
  } else {
    check(false, 'Comando de video desconocido.', 400);
  }
  vs.seq = (vs.seq || 0) + 1;
  vs.updatedAt = now;
  r.videoState = vs;
}

export function answer(r, p, b, now) {
  check(phase(r, now) === 'open', 'Las respuestas están cerradas.');
  const q = r.rounds[r.index];
  check(b.roundId === q.id, 'La ronda cambió.');
  check(p.eligible <= r.index, 'Participarás desde la próxima ronda.');
  check(Number.isInteger(b.choice) && b.choice >= 0 && b.choice < 4, 'Selecciona una alternativa.', 400);
  const key = q.id + ':' + p.id;
  if (r.answers[key]) {
    check(r.answers[key].choice === b.choice, 'Tu respuesta ya fue confirmada.');
    return;
  }
  const correct = b.choice === q.correct;
  const settings = r.settings || { speedBonus: false, streakBonus: false };

  let base = 0;
  let speedBonus = 0;
  let streakBonus = 0;

  if (!q.practice) {
    if (correct) {
      base = 1000;
      p.streak = (p.streak || 0) + 1;
      if (settings.speedBonus && r.deadline && q.seconds > 0) {
        const remaining = Math.max(0, r.deadline - now);
        speedBonus = Math.min(300, Math.max(0, Math.round((300 * remaining) / (q.seconds * 1000))));
      }
      if (settings.streakBonus && p.streak >= 2) {
        streakBonus = Math.min(300, (p.streak - 1) * 100);
      }
    } else {
      p.streak = 0;
    }
  }

  const points = base + speedBonus + streakBonus;
  r.answers[key] = {
    choice: b.choice,
    correct,
    points,
    base,
    speedBonus,
    streakBonus,
    streak: p.streak || 0,
    answeredAt: now
  };
  p.score += points;
}

export function snapshot(r, role, p, now) {
  const stage = phase(r, now);
  const reveal = ['results', 'ranking', 'finished'].includes(stage);
  const q = r.rounds[r.index];
  const settings = r.settings || { speedBonus: false, streakBonus: false };

  const out = {
    code: r.code,
    title: r.title,
    phase: stage,
    index: r.index,
    roundCount: r.rounds.length,
    serverNow: now,
    deadline: stage === 'open' ? r.deadline : null,
    openedAt: r.openedAt || null,
    playerCount: r.players.length,
    settings,
    videoState: r.videoState || { status: 'paused', position: 0, stopAt: q?.cutTime ?? null, seq: 0, updatedAt: now },
    reactions: (r.reactions || []).filter(rx => now - rx.at < 8000).slice(-25)
  };

  if (q) {
    out.round = {
      id: q.id,
      question: q.question,
      practice: q.practice,
      seconds: q.seconds,
      category: q.category || '',
      videoUrl: q.videoUrl || '',
      cutTime: q.cutTime ?? null,
      endTime: q.endTime ?? null
    };
    if (!['watching', 'lobby'].includes(stage) || role === 'host') {
      out.round.options = q.options;
    }
    if (reveal || role === 'host') {
      out.round.correct = q.correct;
    }
  }

  const roundAnswers = q
    ? Object.entries(r.answers)
        .filter(([k]) => k.startsWith(q.id + ':'))
        .map(([, v]) => v)
    : [];

  out.received = roundAnswers.length;

  if (q && (reveal || role === 'host')) {
    const counts = [0, 0, 0, 0];
    for (const ans of roundAnswers) {
      if (ans.choice >= 0 && ans.choice < 4) counts[ans.choice]++;
    }
    const total = roundAnswers.length || 1;
    out.stats = {
      counts,
      total: roundAnswers.length,
      percents: counts.map(c => (roundAnswers.length ? Math.round((c * 100) / total) : 0)),
      correctCount: q.correct !== undefined ? counts[q.correct] : 0
    };
  }

  if (reveal || role === 'host') {
    let prev = -1;
    let rank = 0;
    out.ranking = [...r.players]
      .sort((a, b) => b.score - a.score)
      .map((x, i) => {
        if (x.score !== prev) rank = i + 1;
        prev = x.score;
        return {
          name: x.name,
          avatar: x.avatar || '🎬',
          score: x.score,
          streak: x.streak || 0,
          rank
        };
      });
  }

  if (role === 'host') {
    out.rounds = r.rounds;
    out.players = r.players.map(x => ({
      id: x.id,
      name: x.name,
      avatar: x.avatar || '🎬',
      score: x.score,
      streak: x.streak || 0,
      answered: q ? !!r.answers[q.id + ':' + x.id] : false
    }));
  } else if (stage === 'lobby') {
    out.lobbyPlayers = r.players.map(x => ({
      name: x.name,
      avatar: x.avatar || '🎬'
    }));
  }

  if (p) {
    const a = q && r.answers[q.id + ':' + p.id];
    out.me = {
      name: p.name,
      avatar: p.avatar || '🎬',
      eligible: p.eligible,
      answered: !!a,
      choice: a?.choice,
      streak: p.streak || 0
    };
    if (reveal) {
      const myRankObj = out.ranking?.find(rk => rk.name === p.name);
      Object.assign(out.me, {
        score: p.score,
        rank: myRankObj?.rank || null,
        result: a || { points: 0, base: 0, speedBonus: 0, streakBonus: 0, correct: false }
      });
    }
  }

  return out;
}
