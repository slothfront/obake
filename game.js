/* ガイスター (Geister) — 2人対戦ホットシート実装
 *
 * 盤: 6x6。 row 0 = 上(プレイヤー2の自陣)、 row 5 = 下(プレイヤー1の自陣)。
 * 各プレイヤー: 青(良)4体 + 赤(悪)4体 = 8体。
 *
 * 勝利条件:
 *   1. 相手の青を4体すべて捕獲する
 *   2. 自分の赤を4体すべて捕獲させる（相手に取らせる）
 *   3. 自分の青を、相手陣の左右の隅から盤外へ脱出させる
 */

const SIZE = 6;
const HOME_COLS = [1, 2, 3, 4]; // 中央4列

// 各プレイヤーの脱出マス（相手陣の左右の隅）
const ESCAPE_SQUARES = {
  1: [{ row: 0, col: 0 }, { row: 0, col: 5 }], // P1は上の隅から脱出
  2: [{ row: 5, col: 0 }, { row: 5, col: 5 }], // P2は下の隅から脱出
};

const PLAYER_NAME = { 1: "プレイヤー1", 2: "プレイヤー2" };

const state = {
  privacy: true,
  mode: "normal",      // "normal"（目隠し交代） | "memory"（番号で記憶）
  peek: false,         // 記憶モードで自分の色を一時表示中か
  pieces: [],          // {id, owner, num, color, row, col, captured, facing}
  current: 1,          // 手番のプレイヤー
  selected: null,      // 選択中のコマid（対局中）
  setupPlayer: 1,      // 配置中のプレイヤー
  capturedFrom: { 1: [], 2: [] }, // そのプレイヤーが失った（取られた）コマの色一覧
  winner: null,
  reason: "",
  afterHandoff: null,  // 目隠し画面後に呼ぶ関数
};

/* ---------- ユーティリティ ---------- */

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $("screen-" + name).classList.remove("hidden");
}

function opponent(p) { return p === 1 ? 2 : 1; }

function activePieces() { return state.pieces.filter((p) => !p.captured); }

function pieceAt(row, col) {
  return activePieces().find((p) => p.row === row && p.col === col) || null;
}

function isEscapeSquareFor(player, row, col) {
  return ESCAPE_SQUARES[player].some((s) => s.row === row && s.col === col);
}

function isAnyEscapeSquare(row, col) {
  return isEscapeSquareFor(1, row, col) || isEscapeSquareFor(2, row, col);
}

/* ---------- 初期化 ---------- */

function initPieces() {
  state.pieces = [];
  let id = 0;
  const num = { 1: 1, 2: 1 }; // プレイヤーごとに 1〜8 の番号を振る
  // プレイヤー1: 下2行 (row 5, 4) → 相手側(上)を向く
  for (const row of [5, 4]) {
    for (const col of HOME_COLS) {
      state.pieces.push({ id: id++, owner: 1, num: num[1]++, color: "red", row, col, captured: false, facing: "up" });
    }
  }
  // プレイヤー2: 上2行 (row 0, 1) → 相手側(下)を向く
  for (const row of [0, 1]) {
    for (const col of HOME_COLS) {
      state.pieces.push({ id: id++, owner: 2, num: num[2]++, color: "red", row, col, captured: false, facing: "down" });
    }
  }
}

/* ---------- 描画ヘルパー ---------- */

function makeBoard(container) {
  container.innerHTML = "";
  const cells = [];
  for (let row = 0; row < SIZE; row++) {
    cells[row] = [];
    for (let col = 0; col < SIZE; col++) {
      const cell = document.createElement("div");
      cell.className = "cell" + ((row + col) % 2 ? " alt" : "");
      if (isAnyEscapeSquare(row, col)) cell.classList.add("escape");
      cell.dataset.row = row;
      cell.dataset.col = col;
      container.appendChild(cell);
      cells[row][col] = cell;
    }
  }
  return cells;
}

// プレイヤーごとのコマ画像（所有者は公開情報なので常に表示）
const PIECE_IMG = { 1: "assets/piece-a.png", 2: "assets/piece-b.png" };

function avatarSpan(piece) {
  const w = document.createElement("span");
  w.className = "avatar";
  const img = document.createElement("img");
  img.src = PIECE_IMG[piece.owner];
  img.alt = "";
  img.draggable = false;
  w.appendChild(img);
  return w;
}

// opts: { reveal:bool }
//  reveal=true  → 良い/悪いの色(青/赤)を枠色で表示（自分のコマ / 配置 / 記憶画面 / 捕獲済み）
//  reveal=false → 色を隠す。memoryモードは番号トークン、通常モードは「?」
//  アバター画像（所有者）は常に表示。記憶モードの所有者区別は own/foe で明るさ表現する
function makePieceEl(piece, opts = {}) {
  const { reveal = false } = opts;
  const el = document.createElement("div");
  el.className = "piece face-" + (piece.facing || "up");
  if (reveal) el.classList.add(piece.color);
  else if (state.mode === "memory") el.classList.add("memory");
  else el.classList.add("unknown");

  el.appendChild(avatarSpan(piece));

  // 進行方向を示すポインタ
  const snout = document.createElement("span");
  snout.className = "snout";
  el.appendChild(snout);
  // 番号バッジ
  const badge = document.createElement("span");
  badge.className = "num";
  badge.textContent = piece.num;
  el.appendChild(badge);
  // 通常モードで相手の色が不明なことを示す「?」
  if (!reveal && state.mode !== "memory") {
    const q = document.createElement("span");
    q.className = "qmark";
    q.textContent = "?";
    el.appendChild(q);
  }
  return el;
}

/* ---------- 配置フェーズ ---------- */

function selectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "normal";
}

function startSetup() {
  state.mode = selectedMode();
  state.privacy = $("privacy-toggle").checked;
  initPieces();
  state.setupPlayer = 1;
  enterSetupFor(1);
}

function enterSetupFor(player) {
  state.setupPlayer = player;
  // 当該プレイヤーのコマはすべて赤からスタート
  state.pieces.filter((p) => p.owner === player).forEach((p) => (p.color = "red"));
  $("setup-title").textContent = PLAYER_NAME[player] + "：コマを配置";
  showScreen("setup");
  renderSetup();
}

function renderSetup() {
  const player = state.setupPlayer;
  const cells = makeBoard($("setup-board"));
  state.pieces.filter((p) => p.owner === player).forEach((p) => {
    const cell = cells[p.row][p.col];
    const el = makePieceEl(p, { reveal: true });
    el.classList.add("own");
    el.addEventListener("click", () => toggleSetupColor(p));
    cell.classList.add("selectable");
    cell.appendChild(el);
  });

  const blueCount = state.pieces.filter((p) => p.owner === player && p.color === "blue").length;
  $("setup-blue-count").textContent = blueCount;
  $("btn-setup-confirm").disabled = blueCount !== 4;
}

function toggleSetupColor(piece) {
  const blueCount = state.pieces.filter(
    (p) => p.owner === state.setupPlayer && p.color === "blue"
  ).length;
  if (piece.color === "blue") {
    piece.color = "red";
  } else if (blueCount < 4) {
    piece.color = "blue";
  }
  // 青が4体に達している状態で赤を青にしようとした場合は無視
  renderSetup();
}

function confirmSetup() {
  if (state.mode === "memory") {
    // 記憶モード: 暗記画面を挟む
    showMemorize(state.setupPlayer);
    return;
  }
  if (state.setupPlayer === 1) {
    // プレイヤー2の配置へ（目隠しを挟む）
    runHandoff(2, "コマを配置します", () => enterSetupFor(2));
  } else {
    // 対局開始
    state.current = 1;
    runHandoff(1, "あなたの手番です", startPlay);
  }
}

/* ---------- 記憶（暗記）画面：記憶モード専用 ---------- */

function showMemorize(player) {
  const mine = state.pieces.filter((p) => p.owner === player);
  $("memorize-title").textContent = PLAYER_NAME[player] + "：番号を記憶してください";

  const cells = makeBoard($("memorize-board"));
  mine.forEach((p) => {
    cells[p.row][p.col].appendChild(makePieceEl(p, { reveal: true }));
  });

  const fmt = (color) =>
    mine
      .filter((p) => p.color === color)
      .map((p) => p.num)
      .sort((a, b) => a - b)
      .join("　");
  $("memo-blue").textContent = fmt("blue");
  $("memo-red").textContent = fmt("red");

  showScreen("memorize");
}

function onMemorized() {
  if (state.setupPlayer === 1) {
    runHandoff(2, "コマを配置します", () => enterSetupFor(2));
  } else {
    state.current = 1;
    // 記憶モードでは対局中の目隠しは不要。端末を最初の手番者に戻すだけ。
    runHandoff(1, "対局開始！番号で記憶して戦おう", startPlay);
  }
}

/* ---------- 手番交代（目隠し）画面 ---------- */

function runHandoff(player, text, after) {
  state.afterHandoff = after;
  if (!state.privacy) {
    after();
    return;
  }
  $("handoff-title").textContent = PLAYER_NAME[player] + " に端末を渡してください";
  $("handoff-text").textContent = text;
  showScreen("handoff");
}

function onHandoffContinue() {
  const fn = state.afterHandoff;
  state.afterHandoff = null;
  if (fn) fn();
}

/* ---------- 対局フェーズ ---------- */

function startPlay() {
  state.selected = null;
  state.peek = false;
  showScreen("play");
  renderPlay();
}

function renderPlay() {
  const viewer = state.current; // 手番のプレイヤーの視点
  $("turn-indicator").textContent = PLAYER_NAME[state.current] + " の手番";
  $("turn-indicator").className = "turn-p" + state.current;
  if (!state.selected) {
    $("play-message").textContent = "動かすコマを選んでください";
  }

  const cells = makeBoard($("play-board"));
  const selectedPiece = state.selected != null
    ? state.pieces.find((p) => p.id === state.selected)
    : null;
  const moves = selectedPiece ? legalMoves(selectedPiece) : [];
  const canEscape = moves.some((m) => m.escape);

  // 記憶モード用の確認ボタン表示切替
  const memory = state.mode === "memory";
  $("play-controls").classList.toggle("hidden", !memory);

  // コマ配置
  activePieces().forEach((p) => {
    // 通常: 自分のコマだけ色が見える
    // 記憶: 双方とも色を隠す（番号のみ）。ただし確認中(peek)は自分の色のみ表示
    const reveal = memory ? state.peek && p.owner === viewer : p.owner === viewer;
    const el = makePieceEl(p, { reveal });
    if (memory && p.owner !== viewer) el.classList.add("foe");
    const cell = cells[p.row][p.col];
    const isSelected = selectedPiece && p.id === selectedPiece.id;
    if (isSelected) el.classList.add("selected");

    if (p.owner === viewer) {
      el.classList.add("own");
      if (isSelected && canEscape) {
        // 選択中の青コマが脱出可能 → クリックで脱出
        cell.classList.add("escapable");
        el.addEventListener("click", (e) => { e.stopPropagation(); doEscape(p); });
      } else {
        el.addEventListener("click", (e) => { e.stopPropagation(); selectPiece(p); });
      }
    }
    cell.appendChild(el);
  });

  // 移動先ハイライト（盤上のマス）
  moves.forEach((m) => {
    if (m.escape) return;
    const cell = cells[m.row][m.col];
    cell.classList.add("movable");
    if (m.capture) cell.classList.add("capturable");
    cell.addEventListener("click", () => doMove(selectedPiece, m));
  });

  // 脱出ボタン（選択中の青コマが脱出マスにいるとき表示）
  const escapeBanner = $("escape-banner");
  if (selectedPiece && canEscape) {
    $("play-message").textContent = "脱出できます！下のボタンか、このコマをもう一度タップ";
    escapeBanner.classList.remove("hidden");
    $("btn-escape").onclick = () => doEscape(selectedPiece);
  } else {
    escapeBanner.classList.add("hidden");
    $("btn-escape").onclick = null;
  }

  renderCaptured();
}

function renderCaptured() {
  for (const player of [1, 2]) {
    const box = $("captured-p" + player);
    box.innerHTML = "";
    state.capturedFrom[player].forEach((c) => {
      const mini = document.createElement("div");
      mini.className = "mini " + c.color;
      mini.textContent = c.num;
      box.appendChild(mini);
    });
  }
}

function selectPiece(piece) {
  if (piece.owner !== state.current || piece.captured) return;
  state.selected = piece.id;
  $("play-message").textContent = "移動先を選んでください";
  renderPlay();
}

// あるコマの合法手を列挙
function legalMoves(piece) {
  const moves = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    const r = piece.row + dr;
    const c = piece.col + dc;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
    const occupant = pieceAt(r, c);
    if (occupant && occupant.owner === piece.owner) continue; // 味方の上には進めない
    moves.push({ row: r, col: c, capture: !!occupant });
  }
  // 脱出: 自分の青で、相手陣の隅にいる場合
  if (piece.color === "blue" && isEscapeSquareFor(piece.owner, piece.row, piece.col)) {
    moves.push({ escape: true });
  }
  return moves;
}

function doMove(piece, move) {
  let capturedColor = null;
  const occupant = pieceAt(move.row, move.col);
  if (occupant) {
    occupant.captured = true;
    capturedColor = occupant.color;
    state.capturedFrom[occupant.owner].push({ color: occupant.color, num: occupant.num });
  }
  // 進行方向にコマを向ける
  const dr = move.row - piece.row;
  const dc = move.col - piece.col;
  if (dr < 0) piece.facing = "up";
  else if (dr > 0) piece.facing = "down";
  else if (dc < 0) piece.facing = "left";
  else if (dc > 0) piece.facing = "right";
  piece.row = move.row;
  piece.col = move.col;
  state.selected = null;

  // 勝敗判定
  if (capturedColor) {
    const victim = occupant.owner; // 取られた側
    const taker = piece.owner;
    const blueLost = state.capturedFrom[victim].filter((c) => c.color === "blue").length;
    const redLost = state.capturedFrom[victim].filter((c) => c.color === "red").length;
    if (blueLost >= 4) {
      // 取った側が相手の青を全部取った → 取った側の勝ち
      return endGame(taker, "相手の青いコマを4体すべて捕獲しました。");
    }
    if (redLost >= 4) {
      // 取られた側の赤が全部取られた → 取られた側の勝ち
      return endGame(victim, PLAYER_NAME[taker] + " に赤いコマを4体すべて取らせました。");
    }
  }

  nextTurn();
}

function doEscape(piece) {
  piece.captured = true; // 盤外へ
  state.selected = null;
  endGame(piece.owner, "青いコマが相手陣の隅から脱出しました。");
}

function nextTurn() {
  state.current = opponent(state.current);
  state.selected = null;
  if (state.mode === "memory") {
    // 記憶モードは盤上に色が出ないので目隠し不要。そのまま手番交代。
    showScreen("play");
    renderPlay();
    return;
  }
  runHandoff(state.current, "あなたの手番です", () => {
    showScreen("play");
    renderPlay();
  });
}

/* ---------- 終了 ---------- */

function endGame(winner, reason) {
  state.winner = winner;
  state.reason = reason;
  $("winner-title").textContent = "🎉 " + PLAYER_NAME[winner] + " の勝ち！";
  $("winner-reason").textContent = reason;
  showScreen("gameover");
}

/* ---------- 初期バインド ---------- */

function syncPrivacyRow() {
  // 記憶モードでは目隠しトグルは無効
  $("privacy-row").style.opacity = selectedMode() === "memory" ? "0.4" : "1";
  $("privacy-toggle").disabled = selectedMode() === "memory";
}

function bind() {
  $("btn-start").addEventListener("click", startSetup);
  $("btn-setup-confirm").addEventListener("click", confirmSetup);
  $("btn-handoff").addEventListener("click", onHandoffContinue);
  $("btn-memorized").addEventListener("click", onMemorized);
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", syncPrivacyRow)
  );

  // 記憶モード: 押している間だけ自分のコマの色を表示
  const peekBtn = $("btn-peek");
  const startPeek = (e) => {
    e.preventDefault();
    if (state.mode === "memory" && !state.peek) { state.peek = true; renderPlay(); }
  };
  const endPeek = () => { if (state.peek) { state.peek = false; renderPlay(); } };
  peekBtn.addEventListener("pointerdown", startPeek);
  peekBtn.addEventListener("pointerup", endPeek);
  peekBtn.addEventListener("pointerleave", endPeek);
  peekBtn.addEventListener("pointercancel", endPeek);
  peekBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("pointerup", endPeek);
  window.addEventListener("blur", endPeek);
  $("btn-replay").addEventListener("click", () => {
    state.capturedFrom = { 1: [], 2: [] };
    state.winner = null;
    showScreen("title");
  });
  syncPrivacyRow();
  showScreen("title");
}

document.addEventListener("DOMContentLoaded", bind);
