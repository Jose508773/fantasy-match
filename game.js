const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("start-btn");

const COLS = 8;
const ROWS = 8;
const CELL = 74;
const BOARD_X = 64;
const BOARD_Y = 312;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const TYPES = [
  { key: "ember", fill: "#ff7e67", glow: "#ffb089", glyph: "🔥" },
  { key: "moon", fill: "#83d8ff", glow: "#d8f4ff", glyph: "🌙" },
  { key: "moss", fill: "#9adc77", glow: "#d8ffc1", glyph: "🍃" },
  { key: "royal", fill: "#bf8cff", glow: "#e7d4ff", glyph: "✦" },
  { key: "sun", fill: "#ffd466", glow: "#fff4bf", glyph: "☀" },
  { key: "rose", fill: "#ff7fb6", glow: "#ffd1e5", glyph: "✿" },
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
  state.message = "The relic vault opens. Gather enchanted treasure.";
  state.queuedResolutions = [];
  state.resolving = false;
  state.mode = "playing";
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
    state.message = state.score >= state.goal ? "The kingdom celebrates your vault of relics." : "The moon fades. One more run.";
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
  }
}

function onSelectCell(cell) {
  if (!cell || state.mode !== "playing") return;
  if (!state.selected) {
    state.selected = cell;
    state.message = "Choose a neighboring relic to swap.";
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

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#2f2149");
  gradient.addColorStop(0.55, "#1d1530");
  gradient.addColorStop(1, "#140f22");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 36; i += 1) {
    const x = ((i * 83) % canvas.width) + Math.sin(state.tick * 0.5 + i) * 8;
    const y = ((i * 121) % canvas.height) + Math.cos(state.tick * 0.3 + i) * 10;
    ctx.fillStyle = `rgba(255, 243, 204, ${0.08 + (i % 4) * 0.03})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 213, 131, 0.08)";
  ctx.beginPath();
  ctx.moveTo(0, 220);
  ctx.quadraticCurveTo(180, 140, 360, 220);
  ctx.quadraticCurveTo(560, 300, 720, 190);
  ctx.lineTo(720, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
}

function drawHeader() {
  ctx.textAlign = "left";
  ctx.fillStyle = "#fce8b1";
  ctx.font = '800 58px "Uncial Antiqua"';
  ctx.fillText("Moonlit Relics", 58, 94);
  ctx.font = '500 24px "Cinzel"';
  ctx.fillStyle = "rgba(252, 239, 196, 0.9)";
  ctx.fillText("Harvest runes. Please the Moon Queen. Claim the vault.", 60, 130);

  roundRect(54, 160, 612, 112, 28);
  ctx.fillStyle = "rgba(11, 8, 18, 0.46)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 222, 151, 0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const stats = [
    ["Score", state.score],
    ["Moves", state.moves],
    ["Goal", state.goal],
    ["Combo", `x${state.bestCombo}`],
  ];
  stats.forEach(([label, value], index) => {
    const x = 82 + index * 145;
    ctx.fillStyle = "rgba(255, 229, 172, 0.78)";
    ctx.font = '600 18px "Cinzel"';
    ctx.fillText(label, x, 195);
    ctx.fillStyle = "#fff7db";
    ctx.font = '700 32px "Cinzel"';
    ctx.fillText(String(value), x, 232);
  });

  ctx.fillStyle = "rgba(255, 235, 184, 0.8)";
  ctx.font = '600 16px "Cinzel"';
  ctx.fillText("Mana", 548, 196);
  roundRect(548, 208, 92, 18, 9);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  roundRect(548, 208, 92 * (state.mana / 100), 18, 9);
  ctx.fillStyle = "#7fe3ff";
  ctx.fill();

  ctx.font = '500 19px "Cinzel"';
  ctx.fillStyle = "rgba(248, 235, 202, 0.94)";
  ctx.fillText(state.message, 60, 268);
}

function drawBoard() {
  roundRect(42, 290, 636, 636, 32);
  ctx.fillStyle = "rgba(8, 6, 14, 0.54)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 225, 156, 0.2)";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = BOARD_X + col * CELL;
      const y = BOARD_Y + row * CELL;
      roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 18);
      ctx.fillStyle = (row + col) % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,231,189,0.03)";
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
      ctx.shadowBlur = 24;
      ctx.shadowColor = palette.glow;
      const glow = ctx.createRadialGradient(x - 8, y - 12, 4, x, y, 38);
      glow.addColorStop(0, palette.glow);
      glow.addColorStop(1, palette.fill);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "rgba(255,255,255,0.38)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = '600 24px "Cinzel"';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(palette.glyph, x, y + 1);

      if (orb.special) {
        ctx.strokeStyle = orb.special === "burst" ? "#fff4b8" : "#dffbff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  if (state.selected) {
    const x = BOARD_X + state.selected.col * CELL + 4;
    const y = BOARD_Y + state.selected.row * CELL + 4;
    roundRect(x, y, CELL - 8, CELL - 8, 20);
    ctx.strokeStyle = "#ffe59b";
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function drawFooter() {
  roundRect(54, 955, 612, 240, 28);
  ctx.fillStyle = "rgba(14, 10, 23, 0.62)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 223, 159, 0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffe7a7";
  ctx.font = '700 24px "Cinzel"';
  ctx.fillText("Royal Ledger", 76, 995);

  ctx.font = '500 20px "Cinzel"';
  ctx.fillStyle = "rgba(250, 239, 211, 0.88)";
  ctx.fillText(`Vault progress: ${Math.min(100, Math.round((state.score / state.goal) * 100))}%`, 76, 1034);
  ctx.fillText(`Best cascade: x${state.bestCombo}`, 76, 1072);
  ctx.fillText(`Arcane mana: ${state.mana}/100`, 76, 1110);

  ctx.fillStyle = "rgba(246, 227, 185, 0.72)";
  ctx.font = '500 18px "Cinzel"';
  ctx.fillText("Craft four-matches for line runes. Craft five-matches for burst relics.", 76, 1164);

  if (state.mode === "menu") {
    ctx.fillStyle = "rgba(255, 242, 206, 0.95)";
    ctx.font = '700 28px "Cinzel"';
    ctx.fillText("Begin your quest with the button below.", 76, 1088);
  }

  if (state.mode === "gameover") {
    ctx.fillStyle = state.score >= state.goal ? "#bfffd7" : "#ffd6b3";
    ctx.font = '700 28px "Cinzel"';
    ctx.fillText(state.score >= state.goal ? "Victory for the Moon Queen." : "The vault remains hungry.", 76, 1088);
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
  ctx.fillStyle = "rgba(8, 5, 14, 0.36)";
  roundRect(84, 400, 552, 196, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 221, 153, 0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff0c4";
  ctx.font = '700 36px "Cinzel"';
  ctx.fillText(state.mode === "menu" ? "Moonlit Ceremony" : "Quest Complete", canvas.width / 2, 470);
  ctx.font = '500 22px "Cinzel"';
  ctx.fillText(
    state.mode === "menu"
      ? "Match relics, build cascades, and awaken the vault."
      : "Press R or the button to begin another enchanted run.",
    canvas.width / 2,
    518,
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
  resetGame();
  startButton.classList.add("hidden");
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
render();
requestAnimationFrame(frame);
