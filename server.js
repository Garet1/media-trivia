require('dotenv').config({ quiet: true });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const VENUE_NAME = process.env.VENUE_NAME || 'Media Trivia';
const PRIMARY_COLOR = process.env.PRIMARY_COLOR || '#6C63FF';
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(4).toString('hex');
  console.warn(`⚠️  ADMIN_PASSWORD no configurada. Usando contraseña temporal: ${ADMIN_PASSWORD}`);
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        candidates.push(iface.address);
      }
    }
  }
  return candidates.find(ip => ip.startsWith('192.168.')) || candidates[0] || 'localhost';
}

const LOCAL_IP = getLocalIP();
const PUBLIC_BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://${LOCAL_IP}:${PORT}`;
console.log(`IP local detectada: ${LOCAL_IP}`);
console.log(`URL pública: ${PUBLIC_BASE_URL}`);
console.log(`Venue: ${VENUE_NAME}`);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vote.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

app.get('/admin', (req, res) => {
  const pwd = req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) {
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Media Trivia — Acceso</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111; color: #fff; font-family: 'Segoe UI', sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .box { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px;
      padding: 40px 32px; width: 100%; max-width: 360px; text-align: center; }
    h1 { font-size: 1.4rem; margin-bottom: 8px; }
    p { color: #555; font-size: 0.85rem; margin-bottom: 28px; }
    input { width: 100%; background: #222; border: 1px solid #333; color: #fff;
      padding: 12px 16px; border-radius: 8px; font-size: 1rem; margin-bottom: 12px;
      text-align: center; letter-spacing: 2px; }
    input:focus { outline: none; border-color: ${PRIMARY_COLOR}; }
    button { width: 100%; background: ${PRIMARY_COLOR}; color: #000; border: none;
      padding: 12px; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { opacity: 0.9; }
    .error { color: #c0392b; font-size: 0.85rem; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🎛️ Panel Admin</h1>
    <p>${VENUE_NAME}</p>
    <input type="password" id="pwd" placeholder="Contraseña" onkeydown="if(event.key==='Enter') login()">
    <button onclick="login()">Ingresar</button>
    <div class="error" id="err">Contraseña incorrecta</div>
  </div>
  <script>
    function login() {
      const pwd = document.getElementById('pwd').value;
      if (pwd) window.location.href = '/admin?pwd=' + encodeURIComponent(pwd);
    }
    ${req.query.pwd ? "document.getElementById('err').style.display='block';" : ''}
  </script>
</body>
</html>`);
    return;
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/ip', (req, res) => res.json({ url: PUBLIC_BASE_URL }));
app.get('/api/config', (req, res) => res.json({ venueName: VENUE_NAME, primaryColor: PRIMARY_COLOR }));
app.get('/api/appearance', (req, res) => res.json(appearance));
app.get('/api/qr', async (req, res) => {
  const png = await QRCode.toBuffer(PUBLIC_BASE_URL, { width: 200, margin: 1 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
});

// ── Estado ──────────────────────────────────────────────────────────────────
let currentPoll = null;
let votes = {};
let winnerVisible = false;
let resultsHidden = false;
let timer = null;
let timerRemaining = 0;
let timerTotal = 0;
let waitingScreen = { title: '', subtitle: '' };

const PLAYERS_FILE = path.join(__dirname, 'data', 'players.json');
function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePlayers() {
  try {
    fs.mkdirSync(path.dirname(PLAYERS_FILE), { recursive: true });
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players));
  } catch (err) { console.error('No se pudo guardar el ranking:', err.message); }
}

let players = loadPlayers();
let votedInPoll = {};
let displayRanking = false;
let appearance = {
  bgColor: '#111111', textColor: '#ffffff',
  accentColor: PRIMARY_COLOR, subtitleColor: '#aaaaaa',
  font: 'Bebas Neue', logoUrl: '/logo.png'
};

// Quiz / Cola
let quizLibrary = [];
let activeQueue = [];
let queueIdx = 0;
let queueQuestionIdx = 0;
let queuePlaying = false;
let queueAdvanceTimer = null;
const QUEUE_ADVANCE_DELAY = 8000;

// ── Funciones de poll ────────────────────────────────────────────────────────
function doStartPoll(pollData) {
  if (timer) { clearInterval(timer); timer = null; }
  if (queueAdvanceTimer) { clearTimeout(queueAdvanceTimer); queueAdvanceTimer = null; }
  currentPoll = { ...pollData, id: Date.now().toString() };
  votes = {};
  votedInPoll = {};
  winnerVisible = false;
  resultsHidden = !!pollData.hideResults;
  pollData.options.forEach(opt => { votes[opt.id] = 0; });
  if (displayRanking) { displayRanking = false; io.emit('hide-display-ranking'); }
  io.emit('poll-update', { poll: currentPoll, votes });
  io.emit('results-visibility', { hidden: resultsHidden, votes });
  io.emit('queue-advance-countdown', { seconds: 0 });
  if (pollData.timerSeconds) {
    timerTotal = pollData.timerSeconds;
    timerRemaining = pollData.timerSeconds;
    io.emit('timer-update', { remaining: timerRemaining, total: timerTotal });
    timer = setInterval(() => {
      timerRemaining--;
      io.emit('timer-update', { remaining: timerRemaining, total: timerTotal });
      if (timerRemaining <= 0) { clearInterval(timer); timer = null; doEndPoll(); }
    }, 1000);
  } else {
    timerRemaining = 0; timerTotal = 0;
    io.emit('timer-clear');
  }
}

function doEndPoll() {
  if (timer) { clearInterval(timer); timer = null; }
  timerRemaining = 0;
  winnerVisible = true;
  const winnerId = currentPoll ? (currentPoll.correctId || getWinnerId()) : '';
  emitRanking(); // ranking antes que show-winner para que clientes lo tengan
  io.emit('show-winner', { winnerId, poll: currentPoll, votes });
  io.emit('timer-clear');
  displayRanking = true;
  io.emit('show-display-ranking', getRanking());
  if (queuePlaying) scheduleQueueAdvance();
}

// ── Funciones de cola ────────────────────────────────────────────────────────
function scheduleQueueAdvance() {
  if (queueAdvanceTimer) clearTimeout(queueAdvanceTimer);
  io.emit('queue-advance-countdown', { seconds: QUEUE_ADVANCE_DELAY / 1000 });
  queueAdvanceTimer = setTimeout(() => {
    queueAdvanceTimer = null;
    io.emit('queue-advance-countdown', { seconds: 0 });
    advanceQueue();
  }, QUEUE_ADVANCE_DELAY);
}

function advanceQueue() {
  if (!queuePlaying) return;
  const quiz = activeQueue[queueIdx];
  if (!quiz) { endQueue(); return; }
  if (queueQuestionIdx + 1 < quiz.questions.length) {
    queueQuestionIdx++;
  } else if (queueIdx + 1 < activeQueue.length) {
    queueIdx++;
    queueQuestionIdx = 0;
  } else {
    endQueue();
    return;
  }
  launchCurrentQueueQuestion();
}

function launchCurrentQueueQuestion() {
  const quiz = activeQueue[queueIdx];
  if (!quiz) { endQueue(); return; }
  const question = quiz.questions[queueQuestionIdx];
  doStartPoll({
    title: question.title,
    options: question.options,
    correctId: question.correctId,
    hideResults: quiz.hideResults || false,
    timerSeconds: quiz.timerSeconds || 0
  });
  io.emit('queue-state', getQueueState());
}

function endQueue() {
  queuePlaying = false;
  if (queueAdvanceTimer) { clearTimeout(queueAdvanceTimer); queueAdvanceTimer = null; }
  io.emit('queue-advance-countdown', { seconds: 0 });
  activeQueue = [];
  queueIdx = 0;
  queueQuestionIdx = 0;
  io.emit('queue-state', getQueueState());
  // Mostrar ranking final en display y dispositivos, no volver a espera todavía
  displayRanking = true;
  io.emit('show-display-ranking', getRanking());
  io.emit('queue-finished');
}

function getQueueState() {
  const quiz = activeQueue[queueIdx];
  return {
    playing: queuePlaying,
    queue: activeQueue.map(q => ({ queueEntryId: q.queueEntryId, name: q.name, count: q.questions.length })),
    quizIdx: queueIdx,
    questionIdx: queueQuestionIdx,
    quizName: quiz ? quiz.name : '',
    totalQuestions: quiz ? quiz.questions.length : 0,
    totalQuizzes: activeQueue.length
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getWinnerId() {
  return Object.entries(votes).reduce((a, b) => b[1] > a[1] ? b : a, ['', -1])[0];
}
function getRanking() {
  return Object.values(players).sort((a, b) => b.score - a.score);
}
function emitRanking() {
  const ranking = getRanking();
  io.emit('ranking-update', ranking);
  if (displayRanking) io.emit('show-display-ranking', ranking);
}

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  // Sync completo al conectar
  socket.emit('appearance-update', appearance);
  if (waitingScreen.title || waitingScreen.subtitle) socket.emit('update-waiting', waitingScreen);
  if (currentPoll) {
    socket.emit('poll-update', { poll: currentPoll, votes });
    if (winnerVisible) {
      const winnerId = currentPoll.correctId || getWinnerId();
      socket.emit('show-winner', { winnerId, poll: currentPoll, votes });
    }
  }
  socket.emit('ranking-update', getRanking());
  if (displayRanking) socket.emit('show-display-ranking', getRanking());
  socket.emit('results-visibility', { hidden: resultsHidden, votes });
  if (timer && timerRemaining > 0) socket.emit('timer-update', { remaining: timerRemaining, total: timerTotal });
  socket.emit('quiz-library-update', quizLibrary);
  socket.emit('queue-state', getQueueState());

  socket.on('update-waiting', (data) => { waitingScreen = data; socket.broadcast.emit('update-waiting', data); });
  socket.on('update-appearance', (data) => { appearance = { ...appearance, ...data }; socket.broadcast.emit('appearance-update', appearance); });
  socket.on('reset-appearance', () => {
    appearance = { bgColor: '#111111', textColor: '#ffffff', accentColor: PRIMARY_COLOR, subtitleColor: '#aaaaaa', font: 'Bebas Neue', logoUrl: '/logo.png' };
    io.emit('appearance-update', appearance);
  });

  socket.on('start-poll', (poll) => {
    queuePlaying = false;
    io.emit('queue-state', getQueueState());
    doStartPoll(poll);
  });

  socket.on('vote', ({ optionId, name, docLast3 }) => {
    if (!currentPoll || votes[optionId] === undefined) return;
    const key = `${name}|${docLast3}`;
    if (votedInPoll[key]) return;
    votedInPoll[key] = optionId;
    votes[optionId]++;
    io.emit('votes-update', votes);
    if (!players[key]) players[key] = { name, docLast3, score: 0 };
    if (currentPoll.correctId && optionId === currentPoll.correctId) {
      players[key].score++;
      savePlayers();
      emitRanking();
    }
  });

  socket.on('end-poll', () => { doEndPoll(); });

  socket.on('reset-display', () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (queueAdvanceTimer) { clearTimeout(queueAdvanceTimer); queueAdvanceTimer = null; }
    queuePlaying = false;
    timerRemaining = 0;
    currentPoll = null;
    votes = {};
    votedInPoll = {};
    winnerVisible = false;
    waitingScreen = { title: '', subtitle: '' };
    displayRanking = false;
    io.emit('go-home');
    io.emit('hide-display-ranking');
    io.emit('timer-clear');
    io.emit('queue-advance-countdown', { seconds: 0 });
    io.emit('queue-state', getQueueState());
  });

  socket.on('reset-ranking', () => { players = {}; savePlayers(); emitRanking(); });

  socket.on('toggle-display-ranking', () => {
    displayRanking = !displayRanking;
    if (displayRanking) io.emit('show-display-ranking', getRanking());
    else io.emit('hide-display-ranking');
  });

  // ── Quiz / Cola ────────────────────────────────────────────────────────────
  socket.on('save-quiz', (quiz) => {
    const idx = quizLibrary.findIndex(q => q.id === quiz.id);
    if (idx >= 0) {
      quizLibrary[idx] = quiz;
    } else {
      quizLibrary.push({ ...quiz, id: Date.now().toString() });
    }
    io.emit('quiz-library-update', quizLibrary);
  });

  socket.on('delete-quiz', (quizId) => {
    quizLibrary = quizLibrary.filter(q => q.id !== quizId);
    activeQueue = activeQueue.filter(q => q.id !== quizId);
    io.emit('quiz-library-update', quizLibrary);
    io.emit('queue-state', getQueueState());
  });

  socket.on('add-to-queue', (quizId) => {
    const quiz = quizLibrary.find(q => q.id === quizId);
    if (!quiz) return;
    activeQueue.push({ ...quiz, queueEntryId: `${Date.now()}${Math.random()}` });
    io.emit('queue-state', getQueueState());
  });

  socket.on('remove-from-queue', (queueEntryId) => {
    if (queuePlaying) return;
    activeQueue = activeQueue.filter(q => q.queueEntryId !== queueEntryId);
    io.emit('queue-state', getQueueState());
  });

  socket.on('start-queue', () => {
    if (!activeQueue.length) return;
    queueIdx = 0;
    queueQuestionIdx = 0;
    queuePlaying = true;
    launchCurrentQueueQuestion();
  });

  socket.on('next-question', () => {
    if (!queuePlaying) return;
    if (queueAdvanceTimer) { clearTimeout(queueAdvanceTimer); queueAdvanceTimer = null; }
    io.emit('queue-advance-countdown', { seconds: 0 });
    advanceQueue();
  });

  socket.on('stop-queue', () => { endQueue(); });

  socket.on('disconnect', () => { console.log('Cliente desconectado:', socket.id); });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en ${PUBLIC_BASE_URL}`);
});
