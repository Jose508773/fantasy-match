const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("start-btn");
const audioButton = document.getElementById("audio-btn");

const COLS = 8;
const ROWS = 8;
const CELL = 74;
const BOARD_X = 64;
const BOARD_Y = 356;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const TYPES = [
  { key: "blood", fill: "#b53e4c", glow: "#ef8691", glyph: "✢", icon: "blood" },
  { key: "grave", fill: "#5bb1c5", glow: "#baeaf6", glyph: "☽", icon: "grave" },
  { key: "thorn", fill: "#799449", glow: "#d4ecad", glyph: "❦", icon: "thorn" },
  { key: "void", fill: "#7856b4", glow: "#c7b0ff", glyph: "✦", icon: "void" },
  { key: "gold", fill: "#c89a47", glow: "#f3dc9b", glyph: "✧", icon: "gold" },
  { key: "bone", fill: "#cfc4ae", glow: "#fff1dc", glyph: "☩", icon: "bone" },
];

const state = {
  mode: "menu",
  score: 0,
  moves: 24,
  goal: 4200,
  combo: 0,
  bestCombo: 0,
  mana: 0,
  selected: null,
  hovered: null,
  board: [],
  particles: [],
  message: "Build a chain worthy of the Moon Queen.",
  queuedResolutions: [],
  resolving: false,
  tick: 0,
};

const audioState = {
  enabled: true,
  context: null,
  master: null,
  ambienceStarted: false,
  ambienceTimer: null,
};

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value;
  const int = Number.parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomType() {
  return Math.floor(Math.random() * TYPES.length);
}

function createOrb(type = randomType()) {
  return {
    type,
    offsetX: 0,
    offsetY: 0,
    pulse: Math.random() * Math.PI * 2,
    special: null,
  };
}

function ensureAudio() {
  if (!audioState.enabled) return null;
  if (!audioState.context) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioState.context = new AudioCtor();
    audioState.master = audioState.context.createGain();
    audioState.master.gain.value = 0.12;
    audioState.master.connect(audioState.context.destination);
  }
  if (audioState.context.state === "suspended") {
    audioState.context.resume();
  }
  return audioState.context;
}

function createEnvelope(now, length, attack = 0.02, peak = 0.15, release = 0.14) {
  const ctxAudio = ensureAudio();
  if (!ctxAudio) return null;
  const gain = ctxAudio.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length + release);
  gain.connect(audioState.master);
  return gain;
}

function playTone({
  type = "sine",
  frequency = 220,
  length = 0.24,
  when = 0,
  attack = 0.02,
  peak = 0.15,
  release = 0.14,
  detune = 0,
}) {
  const ctxAudio = ensureAudio();
  if (!ctxAudio) return;
  const now = ctxAudio.currentTime + when;
  const osc = ctxAudio.createOscillator();
  const gain = createEnvelope(now, length, attack, peak, release);
  if (!gain) return;
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (detune) osc.detune.setValueAtTime(detune, now);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + length + release + 0.02);
}

function playNoise({ length = 0.18, peak = 0.05, lowpass = 880, when = 0 }) {
  const ctxAudio = ensureAudio();
  if (!ctxAudio) return;
  const buffer = ctxAudio.createBuffer(1, Math.max(1, Math.floor(ctxAudio.sampleRate * length)), ctxAudio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
  }
  const source = ctxAudio.createBufferSource();
  source.buffer = buffer;
  const filter = ctxAudio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const now = ctxAudio.currentTime + when;
  const gain = createEnvelope(now, length, 0.005, peak, 0.12);
  if (!gain) return;
  source.connect(filter);
  filter.connect(gain);
  source.start(now);
  source.stop(now + length + 0.15);
}

function playMatchSound(comboLevel, cleared) {
  const lift = clamp(comboLevel - 1, 0, 6) * 24;
  playTone({ type: "triangle", frequency: 392 + lift, length: 0.18, peak: 0.08 });
  playTone({ type: "sine", frequency: 523 + lift, length: 0.22, peak: 0.06, when: 0.06 });
  if (cleared >= 4) {
    playTone({ type: "sine", frequency: 784 + lift, length: 0.28, peak: 0.04, when: 0.08 });
  }
}

function playMissSound() {
  playTone({ type: "sawtooth", frequency: 178, length: 0.12, peak: 0.05 });
  playTone({ type: "triangle", frequency: 146, length: 0.2, peak: 0.035, when: 0.05 });
  playNoise({ length: 0.1, peak: 0.015, lowpass: 520 });
}

function playSelectSound() {
  playTone({ type: "triangle", frequency: 294, length: 0.08, peak: 0.035 });
}

function playStartSound() {
  playTone({ type: "sine", frequency: 220, length: 0.25, peak: 0.05 });
  playTone({ type: "triangle", frequency: 330, length: 0.35, peak: 0.06, when: 0.12 });
  playTone({ type: "sine", frequency: 440, length: 0.42, peak: 0.05, when: 0.24 });
}

function scheduleAmbienceBell() {
  if (!audioState.enabled || !audioState.ambienceStarted) return;
  const gap = 4200 + Math.random() * 2400;
  audioState.ambienceTimer = window.setTimeout(() => {
    playTone({ type: "sine", frequency: 262, length: 0.9, peak: 0.03 });
    playTone({ type: "triangle", frequency: 393, length: 0.8, peak: 0.018, when: 0.14 });
    playNoise({ length: 0.4, peak: 0.008, lowpass: 1200 });
    scheduleAmbienceBell();
  }, gap);
}

function startAmbience() {
  const ctxAudio = ensureAudio();
  if (!ctxAudio || audioState.ambienceStarted) return;
  audioState.ambienceStarted = true;

  const drone = ctxAudio.createOscillator();
  const droneGain = ctxAudio.createGain();
  const droneFilter = ctxAudio.createBiquadFilter();
  drone.type = "sawtooth";
  drone.frequency.value = 73.4;
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 320;
  droneGain.gain.value = 0.018;
  drone.connect(droneFilter);
  droneFilter.connect(droneGain);
  droneGain.connect(audioState.master);
  drone.start();

  const upper = ctxAudio.createOscillator();
  const upperGain = ctxAudio.createGain();
  upper.type = "triangle";
  upper.frequency.value = 146.8;
  upperGain.gain.value = 0.008;
  upper.connect(upperGain);
  upperGain.connect(audioState.master);
  upper.start();

  scheduleAmbienceBell();
}

function setAudioEnabled(nextEnabled) {
  audioState.enabled = nextEnabled;
  audioButton.textContent = nextEnabled ? "Sound On" : "Sound Off";
  audioButton.classList.toggle("is-muted", !nextEnabled);
  audioButton.setAttribute("aria-pressed", String(nextEnabled));
  if (!nextEnabled) {
    if (audioState.master) audioState.master.gain.value = 0.0001;
    if (audioState.ambienceTimer) {
      clearTimeout(audioState.ambienceTimer);
      audioState.ambienceTimer = null;
    }
  } else {
    ensureAudio();
    if (audioState.master) audioState.master.gain.value = 0.12;
    startAmbience();
  }
}

function makeBoard() {
  const board = [];
  for (let row = 0; row < ROWS; row += 1) {
    const line = [];
    for (let col = 0; col < COLS; col += 1) {
      let orb = createOrb();
      while (
        (col >= 2 && line[col - 1].type === orb.type && line[col - 2].type === orb.type) ||
        (row >= 2 && board[row - 1][col].type === orb.type && board[row - 2][col].type === orb.type)
      ) {
        orb = createOrb();
      }
      line.push(orb);
    }
    board.push(line);
  }
  return board;
}

function resetGame() {
  state.score = 0;
  state.moves = 24;
  state.combo = 0;
  state.bestCombo = 0;
  state.mana = 0;
  state.selected = null;
  state.hovered = null;
  state.board = makeBoard();
  state.particles = [];
  state.message = "The black vault yawns open. Feed it relics of ash and omen.";
  state.queuedResolutions = [];
  state.resolving = false;
  state.mode = "playing";
  playStartSound();
  startAmbience();
  resolveBoard(true);
}

function boardCellFromPoint(x, y) {
  if (x < BOARD_X || x > BOARD_X + BOARD_W || y < BOARD_Y || y > BOARD_Y + BOARD_H) {
    return null;
  }
  return {
    col: Math.floor((x - BOARD_X) / CELL),
    row: Math.floor((y - BOARD_Y) / CELL),
  };
}

function areAdjacent(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

function swapCells(a, b) {
  const temp = state.board[a.row][a.col];
  state.board[a.row][a.col] = state.board[b.row][b.col];
  state.board[b.row][b.col] = temp;
}

function findMatches() {
  const groups = [];

  for (let row = 0; row < ROWS; row += 1) {
    let start = 0;
    while (start < COLS) {
      const type = state.board[row][start].type;
      let end = start + 1;
      while (end < COLS && state.board[row][end].type === type) {
        end += 1;
      }
      if (end - start >= 3) {
        const cells = [];
        for (let col = start; col < end; col += 1) cells.push({ row, col });
        groups.push(cells);
      }
      start = end;
    }
  }

  for (let col = 0; col < COLS; col += 1) {
    let start = 0;
    while (start < ROWS) {
      const type = state.board[start][col].type;
      let end = start + 1;
      while (end < ROWS && state.board[end][col].type === type) {
        end += 1;
      }
      if (end - start >= 3) {
        const cells = [];
        for (let row = start; row < end; row += 1) cells.push({ row, col });
        groups.push(cells);
      }
      start = end;
    }
  }

  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    let bucket = null;
    for (const existing of merged) {
      if (group.some((cell) => existing.some((other) => other.row === cell.row && other.col === cell.col))) {
        bucket = existing;
        break;
      }
    }
    if (!bucket) {
      bucket = [];
      merged.push(bucket);
    }
    for (const cell of group) {
      const key = `${cell.row}:${cell.col}`;
      if (!seen.has(`${merged.indexOf(bucket)}-${key}`) && !bucket.some((other) => other.row === cell.row && other.col === cell.col)) {
        bucket.push(cell);
      }
    }
  }
  return merged;
}

function spawnParticles(cells, typeIndex) {
  const palette = TYPES[typeIndex];
  for (const cell of cells) {
    const x = BOARD_X + cell.col * CELL + CELL / 2;
    const y = BOARD_Y + cell.row * CELL + CELL / 2;
    for (let i = 0; i < 8; i += 1) {
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 5.4,
        vy: (Math.random() - 0.65) * 5.4,
        life: 1,
        color: palette.glow,
      });
    }
  }
}

function applySpecialEffects(matchSet) {
  const extra = new Set();
  for (const cell of matchSet) {
    const orb = state.board[cell.row][cell.col];
    if (!orb.special) continue;
    if (orb.special === "row") {
      for (let col = 0; col < COLS; col += 1) extra.add(`${cell.row}:${col}`);
    }
    if (orb.special === "col") {
      for (let row = 0; row < ROWS; row += 1) extra.add(`${row}:${cell.col}`);
    }
    if (orb.special === "burst") {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const row = cell.row + dy;
          const col = cell.col + dx;
          if (row >= 0 && row < ROWS && col >= 0 && col < COLS) extra.add(`${row}:${col}`);
        }
      }
    }
  }
  return [...extra].map((key) => {
    const [row, col] = key.split(":").map(Number);
    return { row, col };
  });
}

function clearMatches(groups, initial) {
  const matchSet = [];
  const specialSpawns = [];
  for (const group of groups) {
    for (const cell of group) {
      if (!matchSet.some((item) => item.row === cell.row && item.col === cell.col)) matchSet.push(cell);
    }
    if (!initial && group.length >= 4) {
      const focus = group[Math.floor(group.length / 2)];
      specialSpawns.push({
        row: focus.row,
        col: focus.col,
        type: state.board[focus.row][focus.col].type,
        special: group.length >= 5 ? "burst" : Math.random() > 0.5 ? "row" : "col",
      });
    }
  }

  const extras = applySpecialEffects(matchSet);
  for (const cell of extras) {
    if (!matchSet.some((item) => item.row === cell.row && item.col === cell.col)) matchSet.push(cell);
  }

  if (matchSet.length === 0) return 0;
  spawnParticles(matchSet, state.board[matchSet[0].row][matchSet[0].col].type);

  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const points = matchSet.length * 120 + Math.max(0, state.combo - 1) * 90;
  state.score += points;
  state.mana = Math.min(100, state.mana + matchSet.length * 4 + state.combo * 2);
  state.message = state.combo > 1 ? `Arcane cascade x${state.combo}!` : "A relic chain shatters into stardust.";
  playMatchSound(state.combo, matchSet.length);

  for (const cell of matchSet) {
    state.board[cell.row][cell.col] = null;
  }

  for (const spawn of specialSpawns) {
    if (!state.board[spawn.row][spawn.col]) {
      const orb = createOrb(spawn.type);
      orb.special = spawn.special;
      state.board[spawn.row][spawn.col] = orb;
    }
  }

  return matchSet.length;
}

function collapseBoard() {
  for (let col = 0; col < COLS; col += 1) {
    let writeRow = ROWS - 1;
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      const orb = state.board[row][col];
      if (orb) {
        state.board[writeRow][col] = orb;
        if (writeRow !== row) {
          orb.offsetY = (row - writeRow) * CELL;
        }
        writeRow -= 1;
      }
    }
    while (writeRow >= 0) {
      const orb = createOrb();
      orb.offsetY = -(writeRow + 1) * CELL;
      state.board[writeRow][col] = orb;
      writeRow -= 1;
    }
  }
}

function resolveBoard(initial = false) {
  let loops = 0;
  let totalCleared = 0;
  while (loops < 8) {
    const groups = findMatches();
    if (groups.length === 0) break;
    totalCleared += clearMatches(groups, initial);
    collapseBoard();
    loops += 1;
    initial = false;
  }
  if (totalCleared === 0) state.combo = 0;
  if (!findAnyMove() && state.mode === "playing") {
    state.board = makeBoard();
    state.message = "The stars reshuffle the vault.";
  }
  if (state.moves <= 0) {
    state.mode = "gameover";
    state.message = state.score >= state.goal ? "The Hollow Court accepts your offering." : "The moon fades. The vault remains hungry.";
  }
}

function findAnyMove() {
  const deltas = [
    [1, 0],
    [0, 1],
  ];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [dx, dy] of deltas) {
        const nextCol = col + dx;
        const nextRow = row + dy;
        if (nextCol >= COLS || nextRow >= ROWS) continue;
        swapCells({ row, col }, { row: nextRow, col: nextCol });
        const valid = findMatches().length > 0;
        swapCells({ row, col }, { row: nextRow, col: nextCol });
        if (valid) return true;
      }
    }
  }
  return false;
}

function trySwap(a, b) {
  if (state.mode !== "playing") return;
  swapCells(a, b);
  const hasMatch = findMatches().length > 0;
  if (hasMatch) {
    state.moves = Math.max(0, state.moves - 1);
    resolveBoard(false);
  } else {
    swapCells(a, b);
    state.combo = 0;
    state.message = "That spell fizzled. Seek a truer pairing.";
    playMissSound();
  }
}

function onSelectCell(cell) {
  if (!cell || state.mode !== "playing") return;
  if (!state.selected) {
    state.selected = cell;
    state.message = "Choose a neighboring relic to swap.";
    playSelectSound();
    return;
  }
  if (state.selected.row === cell.row && state.selected.col === cell.col) {
    state.selected = null;
    state.message = "Selection cleared.";
    return;
  }
  if (areAdjacent(state.selected, cell)) {
    const start = state.selected;
    state.selected = null;
    trySwap(start, cell);
    return;
  }
  state.selected = cell;
  state.message = "A new relic is marked.";
  playSelectSound();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function update(dt) {
  state.tick += dt;
  for (const row of state.board) {
    for (const orb of row) {
      if (!orb) continue;
      orb.pulse += dt * 2;
      orb.offsetX += Math.sin(state.tick * 2.2 + row.length + orb.type) * 0.008;
      orb.offsetY *= 0.78;
      if (Math.abs(orb.offsetY) < 0.2) orb.offsetY = 0;
      orb.offsetX *= 0.78;
      if (Math.abs(orb.offsetX) < 0.2) orb.offsetX = 0;
    }
  }
  state.particles = state.particles.filter((particle) => particle.life > 0.02);
  for (const particle of state.particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += 0.04;
    particle.life -= dt * 1.3;
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSigil(x, y, radius, palette) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "rgba(255, 244, 225, 0.76)";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";

  if (palette.icon === "blood") {
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.72);
    ctx.lineTo(radius * 0.28, -radius * 0.1);
    ctx.arc(0, radius * 0.18, radius * 0.26, -0.5, Math.PI + 0.5, true);
    ctx.lineTo(-radius * 0.28, -radius * 0.1);
    ctx.closePath();
    ctx.stroke();
  } else if (palette.icon === "grave") {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.52, 0.5, Math.PI - 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(radius * 0.12, -radius * 0.08, radius * 0.34, 0.4, Math.PI - 0.3);
    ctx.stroke();
  } else if (palette.icon === "thorn") {
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.56);
    ctx.lineTo(0, -radius * 0.58);
    ctx.moveTo(0, -radius * 0.08);
    ctx.lineTo(-radius * 0.42, -radius * 0.42);
    ctx.moveTo(0, radius * 0.1);
    ctx.lineTo(radius * 0.44, -radius * 0.22);
    ctx.stroke();
  } else if (palette.icon === "void") {
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.62);
    ctx.lineTo(radius * 0.22, -radius * 0.16);
    ctx.lineTo(radius * 0.62, 0);
    ctx.lineTo(radius * 0.22, radius * 0.16);
    ctx.lineTo(0, radius * 0.62);
    ctx.lineTo(-radius * 0.22, radius * 0.16);
    ctx.lineTo(-radius * 0.62, 0);
    ctx.lineTo(-radius * 0.22, -radius * 0.16);
    ctx.closePath();
    ctx.stroke();
  } else if (palette.icon === "gold") {
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI / 4) * i;
      const inner = i % 2 === 0 ? radius * 0.18 : radius * 0.54;
      const px = Math.cos(angle) * inner;
      const py = Math.sin(angle) * inner;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (palette.icon === "bone") {
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.54);
    ctx.lineTo(0, radius * 0.54);
    ctx.moveTo(-radius * 0.42, 0);
    ctx.lineTo(radius * 0.42, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -radius * 0.64, radius * 0.16, 0, Math.PI * 2);
    ctx.arc(0, radius * 0.64, radius * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSpire(x, width, height, hue) {
  ctx.save();
  ctx.translate(x, canvas.height);
  ctx.fillStyle = hue;
  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.lineTo(-width * 0.32, -height * 0.42);
  ctx.lineTo(-width * 0.18, -height * 0.42);
  ctx.lineTo(-width * 0.12, -height);
  ctx.lineTo(0, -height * 0.82);
  ctx.lineTo(width * 0.12, -height);
  ctx.lineTo(width * 0.18, -height * 0.42);
  ctx.lineTo(width * 0.32, -height * 0.42);
  ctx.lineTo(width / 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#201628");
  gradient.addColorStop(0.48, "#100c16");
  gradient.addColorStop(1, "#040306");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const moonGlow = ctx.createRadialGradient(360, 118, 12, 360, 118, 138);
  moonGlow.addColorStop(0, "rgba(231, 182, 117, 0.34)");
  moonGlow.addColorStop(1, "rgba(231, 182, 117, 0)");
  ctx.fillStyle = moonGlow;
  ctx.beginPath();
  ctx.arc(360, 118, 140, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(230, 198, 154, 0.82)";
  ctx.beginPath();
  ctx.arc(360, 118, 42, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(120, 29, 47, 0.26)";
  ctx.beginPath();
  ctx.arc(374, 108, 18, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 42; i += 1) {
    const x = ((i * 83) % canvas.width) + Math.sin(state.tick * 0.5 + i) * 8;
    const y = ((i * 121) % canvas.height) + Math.cos(state.tick * 0.3 + i) * 10;
    ctx.fillStyle = `rgba(255, 243, 204, ${0.04 + (i % 4) * 0.02})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(110, 36, 50, 0.08)";
  ctx.beginPath();
  ctx.moveTo(0, 220);
  ctx.quadraticCurveTo(180, 140, 360, 220);
  ctx.quadraticCurveTo(560, 300, 720, 190);
  ctx.lineTo(720, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(18, 12, 24, 0.82)";
  ctx.beginPath();
  ctx.moveTo(0, 996);
  ctx.quadraticCurveTo(140, 936, 280, 978);
  ctx.quadraticCurveTo(410, 1020, 560, 944);
  ctx.quadraticCurveTo(650, 904, 720, 962);
  ctx.lineTo(720, 1280);
  ctx.lineTo(0, 1280);
  ctx.closePath();
  ctx.fill();

  drawSpire(80, 86, 244, "rgba(8, 7, 12, 0.96)");
  drawSpire(174, 72, 198, "rgba(9, 8, 13, 0.92)");
  drawSpire(612, 108, 286, "rgba(8, 7, 12, 0.96)");
  drawSpire(534, 66, 186, "rgba(9, 8, 13, 0.9)");

  const mist = ctx.createLinearGradient(0, 860, 0, 1180);
  mist.addColorStop(0, "rgba(107, 43, 67, 0)");
  mist.addColorStop(0.35, "rgba(107, 43, 67, 0.12)");
  mist.addColorStop(1, "rgba(7, 5, 9, 0.42)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, 820, canvas.width, 460);
}

function drawHeader() {
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(220, 191, 141, 0.8)";
  ctx.font = '600 18px "Cinzel"';
  ctx.fillText("Ritual Ledger", 58, 92);

  roundRect(54, 110, 612, 138, 28);
  ctx.fillStyle = "rgba(9, 7, 13, 0.56)";
  ctx.fill();
  ctx.strokeStyle = "rgba(201, 157, 83, 0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const stats = [
    ["Score", state.score],
    ["Moves", state.moves],
    ["Goal", state.goal],
  ];
  stats.forEach(([label, value], index) => {
    const x = 86 + index * 186;
    ctx.fillStyle = "rgba(212, 180, 125, 0.78)";
    ctx.font = '600 18px "Cinzel"';
    ctx.fillText(label, x, 148);
    ctx.fillStyle = "#f7edd4";
    ctx.font = '700 32px "Cinzel"';
    ctx.fillText(String(value), x, 184);
  });

  ctx.fillStyle = "rgba(212, 180, 125, 0.78)";
  ctx.font = '600 18px "Cinzel"';
  ctx.fillText("Combo", 88, 222);
  ctx.fillStyle = "#f7edd4";
  ctx.font = '700 28px "Cinzel"';
  ctx.fillText(`x${state.bestCombo}`, 88, 246);

  ctx.fillStyle = "rgba(220, 191, 141, 0.8)";
  ctx.font = '600 16px "Cinzel"';
  ctx.fillText("Mana", 454, 222);
  roundRect(454, 230, 170, 18, 9);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  roundRect(454, 230, 170 * (state.mana / 100), 18, 9);
  ctx.fillStyle = "#7b4fd0";
  ctx.fill();

  ctx.font = '500 17px "Cinzel"';
  ctx.fillStyle = "rgba(241, 229, 202, 0.9)";
  ctx.fillText(state.message, 166, 246);
}

function drawBoard() {
  roundRect(42, 290, 636, 636, 32);
  ctx.fillStyle = "rgba(7, 5, 10, 0.68)";
  ctx.fill();
  ctx.strokeStyle = "rgba(201, 157, 83, 0.2)";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = BOARD_X + col * CELL;
      const y = BOARD_Y + row * CELL;
      roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 18);
      ctx.fillStyle = (row + col) % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(158,70,93,0.05)";
      ctx.fill();
    }
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const orb = state.board[row][col];
      if (!orb) continue;
      const x = BOARD_X + col * CELL + CELL / 2 + orb.offsetX;
      const y = BOARD_Y + row * CELL + CELL / 2 + orb.offsetY;
      const palette = TYPES[orb.type];
      const radius = 25 + Math.sin(orb.pulse) * 1.8;

      ctx.save();
      ctx.shadowBlur = 28;
      ctx.shadowColor = palette.glow;
      const glow = ctx.createRadialGradient(x - 8, y - 12, 4, x, y, 38);
      glow.addColorStop(0, "rgba(255,255,255,0.95)");
      glow.addColorStop(0.18, palette.glow);
      glow.addColorStop(1, palette.fill);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 0.84);
      ctx.lineTo(x + radius * 0.58, y - radius * 0.16);
      ctx.lineTo(x + radius * 0.36, y + radius * 0.62);
      ctx.lineTo(x - radius * 0.38, y + radius * 0.62);
      ctx.lineTo(x - radius * 0.58, y - radius * 0.16);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(255,247,225,0.4)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 0.84);
      ctx.lineTo(x + radius * 0.58, y - radius * 0.16);
      ctx.lineTo(x + radius * 0.36, y + radius * 0.62);
      ctx.lineTo(x - radius * 0.38, y + radius * 0.62);
      ctx.lineTo(x - radius * 0.58, y - radius * 0.16);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 0.84);
      ctx.lineTo(x, y + radius * 0.62);
      ctx.moveTo(x + radius * 0.58, y - radius * 0.16);
      ctx.lineTo(x - radius * 0.38, y + radius * 0.62);
      ctx.moveTo(x - radius * 0.58, y - radius * 0.16);
      ctx.lineTo(x + radius * 0.36, y + radius * 0.62);
      ctx.stroke();

      drawSigil(x, y + 1, radius, palette);

      if (orb.special) {
        ctx.strokeStyle = orb.special === "burst" ? "#e2b95f" : "#d7d0ff";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, radius + 13 + Math.sin(state.tick * 4 + row + col) * 1.4, 0, Math.PI * 2);
        ctx.globalAlpha = 0.38;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  if (state.selected) {
    const x = BOARD_X + state.selected.col * CELL + 4;
    const y = BOARD_Y + state.selected.row * CELL + 4;
    roundRect(x, y, CELL - 8, CELL - 8, 20);
    ctx.strokeStyle = "#d14c62";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function drawFooter() {
  roundRect(54, 980, 612, 186, 28);
  ctx.fillStyle = "rgba(10, 7, 14, 0.7)";
  ctx.fill();
  ctx.strokeStyle = "rgba(201, 157, 83, 0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#dfc286";
  ctx.font = '700 24px "Cinzel"';
  ctx.fillText("Ledger Of The Hollow Court", 76, 1018);

  ctx.font = '500 20px "Cinzel"';
  ctx.fillStyle = "rgba(241, 229, 202, 0.84)";
  ctx.fillText(`Vault tithe: ${Math.min(100, Math.round((state.score / state.goal) * 100))}%`, 76, 1052);
  ctx.fillText(`Dark cascade: x${state.bestCombo}`, 76, 1086);
  ctx.fillText(`Forbidden mana: ${state.mana}/100`, 76, 1120);

  ctx.fillStyle = "rgba(225, 202, 159, 0.68)";
  ctx.font = '500 18px "Cinzel"';
  ctx.fillText("Four relics forge line hexes. Five relics awaken a graveburst sigil.", 76, 1149);

  if (state.mode === "menu") {
    ctx.fillStyle = "rgba(244, 229, 201, 0.92)";
    ctx.font = '700 24px "Cinzel"';
    ctx.fillText("Step into the rite with the seal below.", 320, 1086);
  }

  if (state.mode === "gameover") {
    ctx.fillStyle = state.score >= state.goal ? "#d9d0ff" : "#ffcfb8";
    ctx.font = '700 24px "Cinzel"';
    ctx.fillText(state.score >= state.goal ? "The court accepts your offering." : "The vault remains unsated.", 320, 1086);
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.fillStyle = hexToRgba(particle.color, Math.max(0, particle.life));
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMenuOverlay() {
  if (state.mode === "playing") return;
  ctx.fillStyle = "rgba(7, 4, 10, 0.44)";
  roundRect(84, 266, 552, 68, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(201, 157, 83, 0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#f4e3be";
  ctx.font = '700 24px "Cinzel"';
  ctx.fillText(state.mode === "menu" ? "The Hollow Ceremony" : "The Rite Is Complete", canvas.width / 2, 293);
  ctx.font = '500 15px "Cinzel"';
  ctx.fillText(
    state.mode === "menu"
      ? "Match cursed relics, awaken grave sigils, and feed the moonless vault."
      : "Press R or the seal below to begin another descent.",
    canvas.width / 2,
    318,
  );
}

function render() {
  drawBackground();
  drawHeader();
  drawBoard();
  drawFooter();
  drawParticles();
  drawMenuOverlay();
}

let lastTime = 0;
function frame(time) {
  const dt = Math.min(0.033, (time - lastTime) / 1000 || 0.016);
  lastTime = time;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

canvas.addEventListener("mousemove", (event) => {
  const point = pointerPosition(event);
  state.hovered = boardCellFromPoint(point.x, point.y);
});

canvas.addEventListener("click", (event) => {
  const point = pointerPosition(event);
  onSelectCell(boardCellFromPoint(point.x, point.y));
});

canvas.addEventListener("touchstart", (event) => {
  const point = pointerPosition(event);
  onSelectCell(boardCellFromPoint(point.x, point.y));
  event.preventDefault();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r") {
    resetGame();
    startButton.classList.add("hidden");
  }
  if (event.key.toLowerCase() === "f") {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }
  if (event.key === "Escape" && document.fullscreenElement) {
    document.exitFullscreen?.();
  }
});

startButton.addEventListener("click", () => {
  ensureAudio();
  resetGame();
  startButton.classList.add("hidden");
});

audioButton.addEventListener("click", () => {
  const nextEnabled = !audioState.enabled;
  setAudioEnabled(nextEnabled);
  if (nextEnabled) {
    playSelectSound();
  }
});

function compactBoardState() {
  return state.board.map((row) =>
    row.map((orb) => ({
      type: TYPES[orb.type].key,
      special: orb.special,
    })),
  );
}

window.render_game_to_text = () =>
  JSON.stringify({
    note: "origin is top-left; board rows increase downward; cols increase rightward",
    mode: state.mode,
    score: state.score,
    goal: state.goal,
    moves: state.moves,
    combo: state.combo,
    bestCombo: state.bestCombo,
    mana: state.mana,
    selected: state.selected,
    message: state.message,
    board: compactBoardState(),
  });

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) update(1 / 60);
  render();
};

window.__moonlitRelics = {
  resetGame,
  state,
};

state.board = makeBoard();
setAudioEnabled(true);
render();
requestAnimationFrame(frame);
