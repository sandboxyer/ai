#!/usr/bin/env node

import EventEmitter from 'events';

/**
 * Terminal Chat HUD with a nano-like multi-line input box.
 *
 * Input keys:
 *   Enter ............. submit
 *   Shift+Enter ....... newline  (kitty / modifyOtherKeys / CSI-u)
 *   Ctrl+J ............ newline  (universal fallback — works everywhere)
 *   Alt+Enter ......... newline  (some terminals)
 *   ← → ↑ ↓ ........... precise caret motion across lines
 *   Home / End ........ start / end of line (double-Home → text start)
 *   Ctrl+A / Ctrl+E ... text start / end
 *   Ctrl+← / → ........ word jump
 *   Ctrl+↑ / Ctrl+↓ ... first / last line
 *   Backspace ......... delete across line boundaries
 *   Delete ............ delete char / join next line
 *   Ctrl+K / Ctrl+U ... kill to line end / start
 *   Ctrl+W ............ delete word before caret
 *   Ctrl+L ............ redraw
 *   Ctrl+C ............ quit
 *   Ctrl+D ............ quit if input is empty
 *
 * The input box starts at exactly 1 row and grows only as needed.
 * The outer frame is rigid and self-healing.
 *
 * Shift+Enter requires the terminal to report it distinctly. The code
 * requests all three known protocols on start(). If the terminal does
 * not support any of them, Ctrl+J inserts a newline universally.
 */
class ChatHUD extends EventEmitter {
  constructor(config = {}) {
    super();

    this.customSigintHandler = config.onSigint || null;

    this.config = {
      messageProcessor: null,
      colors: {
        border: '\x1b[38;5;39m',
        title: '\x1b[1;38;5;220m',
        user: '\x1b[32m',
        userText: '\x1b[37m',
        bot: '\x1b[36m',
        botText: '\x1b[35m',
        system: '\x1b[33m',
        systemText: '\x1b[37m',
        timestamp: '\x1b[90m',
        prompt: '\x1b[38;5;220m',
        cursor: '\x1b[48;5;220;30m',
        botIndicator: '\x1b[3;90m'
      },
      messages: {
        welcome: '🚀 Welcome to Terminal Chat!',
        initialBot: 'Hello! How can I help you?',
        goodbye: '\n✨ Goodbye! ✨'
      },
      title: 'Terminal Chat',
      onInit: null,
      onExit: null,
      inputMinRows: 1,
      inputMaxRows: 10,
      ...config
    };

    this.messages = [];

    this.inputLines = [''];
    this.caretRow = 0;
    this.caretCol = 0;

    this.inputScrollTop = 0;
    this._preferCol = null;
    this._lastHomePress = 0;

    this.isBotTyping = false;
    this.messageQueue = [];
    this.pendingMessages = [];
    this.isProcessing = false;

    this.width  = Math.max(20, process.stdout.columns || 80);
    this.height = Math.max(8,  process.stdout.rows    || 24);

    this._blinkOn = true;
    this._blinkTimer = null;
    this._healTimer = null;
    this._started = false;
    this._lastRows = -1;

    // Enable keyboard protocols BEFORE attaching the stdin handler so
    // the terminal starts reporting Shift+Enter right away.
    try {
      process.stdout.write('\x1b[>1u');     // kitty: push flags=1
      process.stdout.write('\x1b[=1u');     // kitty: set flags=1
      process.stdout.write('\x1b[>4;2m');   // modifyOtherKeys = 2
      process.stdout.write('\x1b[>4;1m');   // modifyOtherKeys = 1
    } catch (_) { /* not a TTY, ignore */ }

    // Raw stdin only — no readline.
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    this.setupInputHandlers();

    this.clearScreen();
    this.drawFullInterface();

    if (typeof this.config.onInit === 'function') {
      this.config.onInit(this);
    }
  }

  /* ────────────────────── dimensions / layout ───────────────────────── */

  refreshDimensions() {
    this.width  = Math.max(20, process.stdout.columns || 80);
    this.height = Math.max(8,  process.stdout.rows    || 24);
  }

  clearScreen() {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    process.stdout.write('\x1b[?25l');
  }

  computeInputLayout() {
    this.refreshDimensions();
    const W = this.width;
    const textWidth = Math.max(1, W - 5);

    const visualLines = [];
    const rowToVisual = [];

    for (let r = 0; r < this.inputLines.length; r++) {
      rowToVisual[r] = visualLines.length;
      const line = this.inputLines[r];

      if (line.length === 0) {
        visualLines.push({ logicalRow: r, text: '', startCol: 0, endCol: 0 });
        continue;
      }

      for (let start = 0; start < line.length; start += textWidth) {
        const chunk = line.slice(start, start + textWidth);
        visualLines.push({
          logicalRow: r,
          text: chunk,
          startCol: start,
          endCol: start + chunk.length
        });
      }
      if (line.length % textWidth === 0) {
        visualLines.push({
          logicalRow: r,
          text: '',
          startCol: line.length,
          endCol: line.length
        });
      }
    }

    const caretRowStart = rowToVisual[this.caretRow] || 0;
    const caretRowEnd   = (rowToVisual[this.caretRow + 1] ?? visualLines.length);

    let caretVisual = caretRowStart;
    for (let v = caretRowStart; v < caretRowEnd; v++) {
      const vl = visualLines[v];
      if (this.caretCol >= vl.startCol && this.caretCol <= vl.endCol) {
        caretVisual = v;
        if (this.caretCol === vl.endCol &&
            v + 1 < caretRowEnd &&
            visualLines[v + 1].startCol === this.caretCol) {
          caretVisual = v + 1;
        }
      }
    }

    const hardCeiling  = Math.max(1, this.height - 8);
    const inputMaxRows = Math.min(this.config.inputMaxRows, hardCeiling);
    const inputMinRows = Math.min(this.config.inputMinRows, inputMaxRows);

    const needed = visualLines.length;
    const rows   = Math.max(inputMinRows, Math.min(needed, inputMaxRows));

    let scrollTop = this.inputScrollTop;
    if (caretVisual < scrollTop) scrollTop = caretVisual;
    if (caretVisual >= scrollTop + rows) scrollTop = caretVisual - rows + 1;
    scrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, needed - rows)));
    this.inputScrollTop = scrollTop;

    return { textWidth, visualLines, caretVisual, rows, scrollTop, rowToVisual };
  }

  frameRows() {
    this.refreshDimensions();
    const H = this.height;
    const layout = this.computeInputLayout();
    const inputBottom  = H - 1;
    const inputTop     = inputBottom - layout.rows;
    const separatorRow = inputTop - 1;
    return { layout, inputTop, inputBottom, separatorRow };
  }

  /* ──────────────────────────────── frame ───────────────────────────── */

  drawFullInterface() {
    this.refreshDimensions();
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    process.stdout.write('\x1b[?25l');

    const W = this.width;
    const C = this.config.colors;

    process.stdout.write(`${C.border}┌${'─'.repeat(W - 2)}┐\x1b[0m`);

    let title = ` ${this.config.title} `;
    if (title.length > W - 2) title = title.slice(0, W - 3) + ' ';
    const padding  = W - title.length - 2;
    const leftPad  = Math.max(0, Math.floor(padding / 2));
    const rightPad = Math.max(0, padding - leftPad);
    process.stdout.write(`\x1b[2;1H${C.border}│\x1b[0m${' '.repeat(leftPad)}${C.title}${title}\x1b[0m${' '.repeat(rightPad)}${C.border}│\x1b[0m`);

    process.stdout.write(`\x1b[3;1H${C.border}├${'─'.repeat(W - 2)}┤\x1b[0m`);

    const { layout, inputTop, inputBottom, separatorRow } = this.frameRows();
    const messageEnd = separatorRow - 1;

    for (let i = 4; i <= messageEnd; i++) {
      process.stdout.write(`\x1b[${i};1H${C.border}│\x1b[0m\x1b[K\x1b[${i};${W}H${C.border}│\x1b[0m`);
    }

    process.stdout.write(`\x1b[${separatorRow};1H${C.border}├${'─'.repeat(W - 2)}┤\x1b[0m`);

    for (let i = 0; i < layout.rows; i++) {
      const row = inputTop + i;
      process.stdout.write(`\x1b[${row};1H${C.border}│\x1b[0m\x1b[K\x1b[${row};${W}H${C.border}│\x1b[0m`);
    }

    process.stdout.write(`\x1b[${inputBottom};1H${C.border}└${'─'.repeat(W - 2)}┘\x1b[0m`);

    this._lastRows = layout.rows;
    this.redrawMessages();
    this.redrawInput();
  }

  redrawStaticBorders() {
    this.refreshDimensions();
    const W = this.width;
    const C = this.config.colors;

    process.stdout.write(`\x1b[1;1H${C.border}┌${'─'.repeat(W - 2)}┐\x1b[0m`);

    let title = ` ${this.config.title} `;
    if (title.length > W - 2) title = title.slice(0, W - 3) + ' ';
    const padding  = Math.max(0, W - title.length - 2);
    const leftPad  = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    process.stdout.write(`\x1b[2;1H${C.border}│\x1b[0m${' '.repeat(leftPad)}${C.title}${title}\x1b[0m${' '.repeat(rightPad)}${C.border}│\x1b[0m`);

    process.stdout.write(`\x1b[3;1H${C.border}├${'─'.repeat(W - 2)}┤\x1b[0m`);

    const { layout, inputTop, inputBottom, separatorRow } = this.frameRows();

    process.stdout.write(`\x1b[${separatorRow};1H${C.border}├${'─'.repeat(W - 2)}┤\x1b[0m`);
    process.stdout.write(`\x1b[${inputBottom};1H${C.border}└${'─'.repeat(W - 2)}┘\x1b[0m`);

    for (let i = 4; i <= separatorRow - 1; i++) {
      process.stdout.write(`\x1b[${i};1H${C.border}│\x1b[0m`);
      process.stdout.write(`\x1b[${i};${W}H${C.border}│\x1b[0m`);
    }
    for (let i = 0; i < layout.rows; i++) {
      const row = inputTop + i;
      process.stdout.write(`\x1b[${row};1H${C.border}│\x1b[0m`);
      process.stdout.write(`\x1b[${row};${W}H${C.border}│\x1b[0m`);
    }
  }

  setTitle(newTitle) {
    this.config.title = newTitle;
    this.drawFullInterface();
  }

  /* ─────────────────────────── input handling ───────────────────────── */

  setupInputHandlers() {
    let escapeBuffer = '';
    let escapeTimer  = null;

    const resetEscape = () => {
      escapeBuffer = '';
      if (escapeTimer) { clearTimeout(escapeTimer); escapeTimer = null; }
    };

    const isCompleteEscape = (buf) => {
      if (/^\x1bO[A-Za-z]$/.test(buf)) return true;
      if (/^\x1b\[[0-9;?]*[ -/]*[@-~]$/.test(buf)) return true;
      return false;
    };

    process.stdin.on('data', (chunk) => {
      const data = chunk.toString('utf8');

      if (data === '\u0003') {
        this.cleanup();
        process.exit();
        return;
      }

      if (escapeBuffer) {
        escapeBuffer += data;
        if (isCompleteEscape(escapeBuffer)) {
          const seq = escapeBuffer;
          resetEscape();
          this.handleEscapeSequence(seq);
        } else if (escapeBuffer.length > 16) {
          resetEscape();
        } else {
          if (escapeTimer) clearTimeout(escapeTimer);
          escapeTimer = setTimeout(resetEscape, 120);
        }
        return;
      }

      if (data === '\u001b') {
        escapeBuffer = data;
        escapeTimer = setTimeout(resetEscape, 120);
        return;
      }

      if (data.length > 1) {
        let rest = data;
        while (rest.length) {
          if (rest[0] === '\u001b') {
            const m = rest.match(/^\x1bO[A-Za-z]|^\x1b\[[0-9;?]*[ -/]*[@-~]/);
            if (m) {
              this.handleEscapeSequence(m[0]);
              rest = rest.slice(m[0].length);
              continue;
            }
            escapeBuffer = rest;
            escapeTimer = setTimeout(resetEscape, 120);
            return;
          }
          const nextEsc = rest.indexOf('\u001b');
          const textPart = nextEsc === -1 ? rest : rest.slice(0, nextEsc);
          if (textPart.length) {
            const cleaned = this.sanitizePastedText(textPart);
            if (cleaned.length) this.insertText(cleaned);
          }
          rest = nextEsc === -1 ? '' : rest.slice(nextEsc);
        }
        return;
      }

      const code = data.charCodeAt(0);

      // Enter / LF
      if (code === 13) { this.handleEnter(); return; }   // CR → submit
      if (code === 10) { this.insertNewline(); return; } // LF → newline

      if (code === 8  || code === 127) { this.handleBackspace(); return; }
      if (code === 1)  { this.moveToTextStart();                 return; }
      if (code === 5)  { this.moveToTextEnd();                   return; }
      if (code === 11) { this.killToLineEnd();                   return; }
      if (code === 21) { this.killToLineStart();                 return; }
      if (code === 23) { this.deleteWordBefore();                return; }
      if (code === 12) { this.drawFullInterface();               return; }
      if (code === 4)  {
        const empty = this.inputLines.length === 1 && this.inputLines[0] === '';
        if (empty) { this.cleanup(); process.exit(); }
        this.deleteForward();
        return;
      }
      if (code < 32) return;

      this.insertText(data);
    });
  }

  handleEscapeSequence(seq) {
    // ── CSI-u (kitty / foot / wezterm / Ghostty / Alacritty ≥0.13) ────
    // Format: ESC [ <code> ; <mod> u    (mod: 1 none, 2 Shift, 3 Alt,
    //                                    5 Ctrl, 9 Cmd, sums for combos)
    let m = seq.match(/^\x1b\[(\d+);(\d+)u$/);
    if (m) {
      const code = parseInt(m[1], 10);
      const mod  = parseInt(m[2], 10);
      if (code === 13) {
        if (mod & 2) this.insertNewline();   // Shift+Enter → newline
        else         this.handleEnter();     // Enter → submit
        return;
      }
      return;
    }

    // ── modifyOtherKeys (xterm, GNOME Terminal, Konsole, Windows
    //    Terminal, older iTerm2). Format: ESC [ 27 ; mod ; code ~
    m = seq.match(/^\x1b\[27;(\d+);(\d+)~$/);
    if (m) {
      const mod  = parseInt(m[1], 10);
      const code = parseInt(m[2], 10);
      if (code === 13) {
        if (mod & 2) this.insertNewline();
        else         this.handleEnter();
        return;
      }
      return;
    }

    const s = seq;

    // Arrows
    if (s === '\x1b[C' || s === '\x1bOC') { this.moveRight(); return; }
    if (s === '\x1b[D' || s === '\x1bOD') { this.moveLeft();  return; }
    if (s === '\x1b[A' || s === '\x1bOA') { this.moveUp();    return; }
    if (s === '\x1b[B' || s === '\x1bOB') { this.moveDown();  return; }

    // Home / End
    if (s === '\x1b[H'  || s === '\x1bOH' ||
        s === '\x1b[1~' || s === '\x1b[7~') { this.handleHome(); return; }
    if (s === '\x1b[F'  || s === '\x1bOF' ||
        s === '\x1b[4~' || s === '\x1b[8~') { this.handleEnd();  return; }

    // Delete
    if (s === '\x1b[3~') { this.deleteForward(); return; }

    // Word-wise motion (Ctrl/Alt/Cmd + Left/Right)
    const leftSeqs = new Set([
      '\x1b[1;3D', '\x1b[1;5D', '\x1b[1;9D',
      '\x1b[3D',   '\x1b[5D',
      '\x1b[1;2D', '\x1b[1;4D', '\x1b[1;6D', '\x1b[1;7D', '\x1b[1;8D'
    ]);
    const rightSeqs = new Set([
      '\x1b[1;3C', '\x1b[1;5C', '\x1b[1;9C',
      '\x1b[3C',   '\x1b[5C',
      '\x1b[1;2C', '\x1b[1;4C', '\x1b[1;6C', '\x1b[1;7C', '\x1b[1;8C'
    ]);
    if (leftSeqs.has(s))  { this.moveWordLeft();  return; }
    if (rightSeqs.has(s)) { this.moveWordRight(); return; }

    // Ctrl+Up / Ctrl+Down
    if (s === '\x1b[1;5A') { this.moveToTextStart(); return; }
    if (s === '\x1b[1;5B') { this.moveToTextEnd();   return; }

    // Alt+b / Alt+f
    if (s === '\x1bb') { this.moveWordLeft();  return; }
    if (s === '\x1bf') { this.moveWordRight(); return; }

    // Alt+Enter — ESC followed by CR or LF
    if (s === '\x1b\r' || s === '\x1b\x0a') { this.insertNewline(); return; }

    // Shift+Enter variants that arrive as standalone escapes
    //   \x1b[13;2u  (CSI-u)              — handled above
    //   \x1b[27;2;13~ (modifyOtherKeys)  — handled above
    //   \x1b\x1b[13;2u (double ESC prefix from some SSH relays)
    if (s === '\x1b\x1b[13;2u' || s === '\x1b\x1b[27;2;13~') {
      this.insertNewline();
      return;
    }
  }

  sanitizePastedText(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1bO[A-Za-z]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /* ────────────────────────────── editing ───────────────────────────── */

  insertText(text) {
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) this.insertNewlineRaw();
      if (parts[i].length) this.insertTextRaw(parts[i]);
    }
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  insertTextRaw(str) {
    const line = this.inputLines[this.caretRow];
    this.inputLines[this.caretRow] =
      line.slice(0, this.caretCol) + str + line.slice(this.caretCol);
    this.caretCol += str.length;
  }

  insertNewlineRaw() {
    const line = this.inputLines[this.caretRow];
    const before = line.slice(0, this.caretCol);
    const after  = line.slice(this.caretCol);
    this.inputLines[this.caretRow] = before;
    this.inputLines.splice(this.caretRow + 1, 0, after);
    this.caretRow += 1;
    this.caretCol = 0;
  }

  insertNewline() {
    this.insertNewlineRaw();
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  handleBackspace() {
    if (this.caretCol > 0) {
      const line = this.inputLines[this.caretRow];
      this.inputLines[this.caretRow] =
        line.slice(0, this.caretCol - 1) + line.slice(this.caretCol);
      this.caretCol--;
    } else if (this.caretRow > 0) {
      const prev = this.inputLines[this.caretRow - 1];
      const cur  = this.inputLines[this.caretRow];
      this.inputLines[this.caretRow - 1] = prev + cur;
      this.inputLines.splice(this.caretRow, 1);
      this.caretRow -= 1;
      this.caretCol = prev.length;
    }
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  deleteForward() {
    const line = this.inputLines[this.caretRow];
    if (this.caretCol < line.length) {
      this.inputLines[this.caretRow] =
        line.slice(0, this.caretCol) + line.slice(this.caretCol + 1);
    } else if (this.caretRow < this.inputLines.length - 1) {
      const next = this.inputLines[this.caretRow + 1];
      this.inputLines[this.caretRow] = line + next;
      this.inputLines.splice(this.caretRow + 1, 1);
    }
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  killToLineEnd() {
    this.inputLines[this.caretRow] = this.inputLines[this.caretRow].slice(0, this.caretCol);
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  killToLineStart() {
    this.inputLines[this.caretRow] = this.inputLines[this.caretRow].slice(this.caretCol);
    this.caretCol = 0;
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  deleteWordBefore() {
    if (this.caretCol === 0 && this.caretRow > 0) {
      this.handleBackspace();
      return;
    }
    const line = this.inputLines[this.caretRow];
    const before = line.slice(0, this.caretCol);
    let i = before.length;
    while (i > 0 && /\s/.test(before[i - 1])) i--;
    while (i > 0 && !/[\s.,;:!?()\[\]{}<>"']/.test(before[i - 1])) i--;
    this.inputLines[this.caretRow] = line.slice(0, i) + line.slice(this.caretCol);
    this.caretCol = i;
    this._preferCol = null;
    this.relayoutAndRedraw();
  }

  /* ────────────────────────────── motion ────────────────────────────── */

  moveLeft() {
    if (this.caretCol > 0) this.caretCol--;
    else if (this.caretRow > 0) {
      this.caretRow--;
      this.caretCol = this.inputLines[this.caretRow].length;
    }
    this._preferCol = null;
    this.redrawInput();
  }

  moveRight() {
    const line = this.inputLines[this.caretRow];
    if (this.caretCol < line.length) this.caretCol++;
    else if (this.caretRow < this.inputLines.length - 1) {
      this.caretRow++;
      this.caretCol = 0;
    }
    this._preferCol = null;
    this.redrawInput();
  }

  moveUp() {
    if (this._preferCol == null) this._preferCol = this.caretCol;
    if (this.caretRow > 0) {
      this.caretRow--;
      this.caretCol = Math.min(this._preferCol, this.inputLines[this.caretRow].length);
    }
    this.redrawInput();
  }

  moveDown() {
    if (this._preferCol == null) this._preferCol = this.caretCol;
    if (this.caretRow < this.inputLines.length - 1) {
      this.caretRow++;
      this.caretCol = Math.min(this._preferCol, this.inputLines[this.caretRow].length);
    }
    this.redrawInput();
  }

  moveToTextStart() {
    this.caretRow = 0;
    this.caretCol = 0;
    this._preferCol = null;
    this.redrawInput();
  }

  moveToTextEnd() {
    this.caretRow = this.inputLines.length - 1;
    this.caretCol = this.inputLines[this.caretRow].length;
    this._preferCol = null;
    this.redrawInput();
  }

  handleHome() {
    const now = Date.now();
    if (now - this._lastHomePress < 500) {
      this._lastHomePress = 0;
      this.moveToTextStart();
      return;
    }
    this._lastHomePress = now;
    this.caretCol = 0;
    this._preferCol = null;
    this.redrawInput();
  }

  handleEnd() {
    this.caretCol = this.inputLines[this.caretRow].length;
    this._preferCol = null;
    this.redrawInput();
  }

  moveWordLeft() {
    if (this.caretCol === 0 && this.caretRow > 0) {
      this.caretRow--;
      this.caretCol = this.inputLines[this.caretRow].length;
      this._preferCol = null;
      this.redrawInput();
      return;
    }
    const line = this.inputLines[this.caretRow];
    let pos = this.caretCol;
    while (pos > 0 && /\s/.test(line[pos - 1])) pos--;
    while (pos > 0 && !/[\s.,;:!?()\[\]{}<>"']/.test(line[pos - 1])) pos--;
    this.caretCol = pos;
    this._preferCol = null;
    this.redrawInput();
  }

  moveWordRight() {
    const line = this.inputLines[this.caretRow];
    const len = line.length;
    if (this.caretCol >= len && this.caretRow < this.inputLines.length - 1) {
      this.caretRow++;
      this.caretCol = 0;
      this._preferCol = null;
      this.redrawInput();
      return;
    }
    let pos = this.caretCol;
    while (pos < len && !/[\s.,;:!?()\[\]{}<>"']/.test(line[pos])) pos++;
    while (pos < len &&  /[\s.,;:!?()\[\]{}<>"']/.test(line[pos])) pos++;
    this.caretCol = pos;
    this._preferCol = null;
    this.redrawInput();
  }

  handleEnter() {
    const joined = this.inputLines.join('\n').trim();
    if (!joined) return;

    const userMessage = this.inputLines.join('\n');
    this.inputLines = [''];
    this.caretRow = 0;
    this.caretCol = 0;
    this._preferCol = null;
    this.inputScrollTop = 0;

    this.addMessage('You', userMessage, this.config.colors.user);
    this.emit('userMessage', userMessage);

    if (this.isBotTyping) {
      this.pendingMessages.push(userMessage);
    } else {
      this.messageQueue.push(userMessage);
      this.processQueue();
    }

    this.drawFullInterface();
  }

  relayoutAndRedraw() {
    const layout = this.computeInputLayout();
    if (layout.rows !== this._lastRows) {
      this.drawFullInterface();
    } else {
      this.redrawMessages();
      this.redrawInput();
    }
  }

  /* ──────────────────────────── bot pipeline ────────────────────────── */

  processQueue() {
    if (this.isProcessing || this.messageQueue.length === 0 || this.isBotTyping) return;
    this.isProcessing = true;

    const processNext = async () => {
      while (this.messageQueue.length > 0 && !this.isBotTyping) {
        const currentMessage = this.messageQueue.shift();
        const messagesToProcess = [currentMessage, ...this.pendingMessages];
        this.pendingMessages = [];
        await this.generateBotResponse(messagesToProcess);
      }
      this.isProcessing = false;
    };

    processNext();
  }

  async generateBotResponse(messages) {
    this.isBotTyping = true;
    this.redrawInput();

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const botMessage = {
      sender: 'Bot',
      text: '',
      timestamp,
      timestamp_raw: Date.now(),
      labelColor: this.config.colors.bot,
      textColor: this.config.colors.botText,
      lines: []
    };

    this.messages.push(botMessage);
    this.redrawMessages();

    if (typeof this.config.messageProcessor === 'function') {
      const triggerMessage = messages[messages.length - 1];
      await this.config.messageProcessor(triggerMessage, this.displayToken.bind(this), messages);
    } else {
      const response = this.getDefaultBotResponse(messages.join(' '));
      this.emit('botResponseStarted', messages);

      let currentText = '';
      for (let i = 0; i < response.length; i++) {
        currentText += response[i];
        const last = this.messages[this.messages.length - 1];
        if (last && last.sender === 'Bot') {
          last.text = currentText;
          last.lines = currentText.split('\n');
        }
        this.redrawMessages();
        await new Promise(r => setTimeout(r, 40 + Math.random() * 40));
      }

      this.emit('botResponseCompleted', response);
    }

    this.isBotTyping = false;
    this.redrawInput();

    if (this.pendingMessages.length > 0) {
      this.messageQueue.push(...this.pendingMessages);
      this.pendingMessages = [];
    }
    if (this.messageQueue.length > 0) this.processQueue();
  }

  async displayToken(token) {
    let last = null;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].sender === 'Bot') { last = this.messages[i]; break; }
    }

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const now = Date.now();
    const age = last ? now - (last.timestamp_raw || 0) : Infinity;

    if (!last || age > 2000) {
      this.messages.push({
        sender: 'Bot',
        text: token,
        timestamp,
        timestamp_raw: now,
        labelColor: this.config.colors.bot,
        textColor: this.config.colors.botText,
        lines: token.split('\n')
      });
    } else {
      last.text += token;
      last.timestamp_raw = now;
      last.lines = last.text.split('\n');
    }

    this.redrawMessages();
  }

  getDefaultBotResponse(message) {
    const lower = message.toLowerCase();
    const r = {
      greeting: ['Hello!', 'Hi there!', 'Hey!', 'Greetings!'],
      question: ['Interesting question...', 'Let me think...', 'Good question!'],
      bye: ['Goodbye!', 'See you later!', 'Take care!'],
      default: ['Nice!', 'Cool!', 'Awesome!', 'Got it!', 'Interesting!']
    };
    if (lower.includes('hello') || lower.includes('hi')) return r.greeting[Math.floor(Math.random() * r.greeting.length)];
    if (lower.includes('?')) return r.question[Math.floor(Math.random() * r.question.length)];
    if (lower.includes('bye')) return r.bye[Math.floor(Math.random() * r.bye.length)];
    return r.default[Math.floor(Math.random() * r.default.length)];
  }

  addMessage(sender, text, color) {
    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    let labelColor, textColor;
    if (sender === 'Bot') {
      labelColor = this.config.colors.bot;
      textColor  = this.config.colors.botText;
    } else if (sender === 'You') {
      labelColor = this.config.colors.user;
      textColor  = this.config.colors.userText;
    } else {
      labelColor = this.config.colors.system;
      textColor  = this.config.colors.systemText;
    }

    this.messages.push({
      sender, text, timestamp, labelColor, textColor,
      lines: text.split('\n')
    });
    this.redrawMessages();
  }

  /* ──────────────────────────── redraws ─────────────────────────────── */

  redrawMessages() {
    this.refreshDimensions();
    const W = this.width;
    const C = this.config.colors;

    const { separatorRow } = this.frameRows();
    const messageStartLine = 4;
    const messageEndLine   = separatorRow - 1;
    const messageLines     = Math.max(0, messageEndLine - messageStartLine + 1);

    const displayLines = [];

    for (const msg of this.messages) {
      const msgLines = msg.lines || msg.text.split('\n');

      const labelColor = msg.labelColor ||
        (msg.sender === 'Bot' ? C.bot :
         msg.sender === 'You' ? C.user : C.system);
      const textColor = msg.textColor ||
        (msg.sender === 'Bot' ? C.botText :
         msg.sender === 'You' ? C.userText : C.systemText) || '\x1b[37m';

      const prefix = `[${msg.timestamp}] ${msg.sender}: `;
      const prefixLength = this.stripAnsi(prefix).length;
      const firstLineAvailable = Math.max(1, W - prefixLength - 4);
      const continuationIndent = ' '.repeat(prefixLength - 1);
      const continuationAvailable = Math.max(1, W - continuationIndent.length - 4);

      for (let j = 0; j < msgLines.length; j++) {
        const line = msgLines[j];
        if (j === 0) {
          const coloredPrefix = `${C.timestamp}[${msg.timestamp}]\x1b[0m ${labelColor}${msg.sender}:\x1b[0m `;
          const wrapped = this.wrapText(line, firstLineAvailable);
          for (let k = 0; k < wrapped.length; k++) {
            displayLines.push(k === 0
              ? { prefix: coloredPrefix, text: wrapped[k], textColor }
              : { prefix: continuationIndent, text: wrapped[k], textColor });
          }
        } else {
          const wrapped = this.wrapText(line, continuationAvailable);
          for (const w of wrapped) {
            displayLines.push({ prefix: continuationIndent, text: w, textColor });
          }
        }
      }
    }

    const startIndex = Math.max(0, displayLines.length - messageLines);

    for (let i = 0; i < messageLines; i++) {
      const row = messageStartLine + i;
      process.stdout.write(`\x1b[${row};1H${C.border}│\x1b[0m`);
      if (startIndex + i < displayLines.length) {
        const dl = displayLines[startIndex + i];
        process.stdout.write(dl.prefix);
        process.stdout.write(`${dl.textColor || ''}${dl.text}\x1b[0m`);
      }
      process.stdout.write('\x1b[0m\x1b[K');
      process.stdout.write(`\x1b[${row};${W}H${C.border}│\x1b[0m`);
    }
  }

  stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  }

  wrapText(text, maxWidth) {
    if (maxWidth <= 0) return [text];
    if (text.length <= maxWidth) return [text];

    const words = text.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (test.length <= maxWidth) cur = test;
      else {
        if (cur) lines.push(cur);
        if (word.length > maxWidth) {
          let rem = word;
          while (rem.length > maxWidth) {
            lines.push(rem.substring(0, maxWidth - 1) + '-');
            rem = rem.substring(maxWidth - 1);
          }
          cur = rem;
        } else cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  redrawInput() {
    this.refreshDimensions();
    const W = this.width;
    const C = this.config.colors;

    const { layout, inputTop } = this.frameRows();
    const { textWidth, visualLines, rows, scrollTop, caretVisual } = layout;

    const visible = visualLines.slice(scrollTop, scrollTop + rows);

    let caretColInVisual = 0;
    {
      const vl = visualLines[caretVisual] || { startCol: 0, endCol: 0 };
      caretColInVisual = Math.max(0, Math.min(textWidth, this.caretCol - vl.startCol));
    }

    for (let i = 0; i < rows; i++) {
      const row = inputTop + i;
      const vl  = visible[i];

      process.stdout.write(`\x1b[${row};1H${C.border}│\x1b[0m`);

      if (i === 0) process.stdout.write(` ${C.prompt}➤\x1b[0m `);
      else         process.stdout.write('   ');

      if (!vl) {
        process.stdout.write('\x1b[0m\x1b[K');
        process.stdout.write(`\x1b[${row};${W}H${C.border}│\x1b[0m`);
        continue;
      }

      const text   = vl.text;
      const visIdx = scrollTop + i;

      if (visIdx === caretVisual) {
        const before = text.slice(0, caretColInVisual);
        const ch     = text[caretColInVisual] || ' ';
        const after  = text.slice(caretColInVisual + 1);

        process.stdout.write(before);
        if (this._blinkOn) process.stdout.write(`${C.cursor}${ch}\x1b[0m`);
        else               process.stdout.write(ch);
        process.stdout.write(after);
      } else {
        process.stdout.write(text);
      }

      process.stdout.write('\x1b[0m\x1b[K');

      if (i === rows - 1 && this.isBotTyping) {
        const botText = '[bot]';
        const botCol  = W - botText.length;
        if (botCol > 5) {
          process.stdout.write(`\x1b[${row};${botCol}H${C.botIndicator}${botText}\x1b[0m`);
        }
      }

      process.stdout.write(`\x1b[${row};${W}H${C.border}│\x1b[0m`);
    }

    const caretRowOnScreen = inputTop + (caretVisual - scrollTop);
    const caretX = 1 + 3 + caretColInVisual + 1;
    process.stdout.write(`\x1b[${caretRowOnScreen};${Math.min(caretX, W - 1)}H`);
  }

  /* ───────────────────────────── lifecycle ──────────────────────────── */

  cleanup() {
    if (this._blinkTimer) { clearInterval(this._blinkTimer); this._blinkTimer = null; }
    if (this._healTimer)  { clearInterval(this._healTimer);  this._healTimer  = null; }

    try {
      process.stdout.write('\x1b[<u');      // pop kitty keyboard mode
      process.stdout.write('\x1b[>4;0m');   // disable modifyOtherKeys
      process.stdout.write('\x1b[2J\x1b[3J\x1b[0;0H');
      process.stdout.write('\x1b[?25h');
      process.stdout.write('\x1b[0m');
    } catch (_) { /* ignore */ }

    if (process.stdin.isTTY) process.stdin.setRawMode(false);

    process.removeAllListeners('SIGINT');

    if (typeof this.config.onExit === 'function') {
      setTimeout(() => this.config.onExit(this), 0);
    }

    if (activeChatInstance === this) activeChatInstance = null;
  }

  start() {
    if (this._started) return;
    this._started = true;
    activeChatInstance = this;

    process.stdout.on('resize', () => {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      process.stdout.write('\x1b[?25l');
      this.drawFullInterface();
    });

    this._blinkTimer = setInterval(() => {
      this._blinkOn = !this._blinkOn;
      this.redrawInput();
    }, 500);

    this._healTimer = setInterval(() => this.redrawStaticBorders(), 1500);

    this.emit('started');
  }

  sendMessage(sender, message, color = '\x1b[36m') {
    this.addMessage(sender, message, color);
  }

  async simulateBotResponse(response) {
    this.isBotTyping = true;
    this.redrawInput();

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const idx = this.messages.length;
    this.messages.push({
      sender: 'Bot', text: '', timestamp,
      labelColor: this.config.colors.bot,
      textColor: this.config.colors.botText,
      lines: []
    });

    let currentText = '';
    for (let i = 0; i < response.length; i++) {
      currentText += response[i];
      this.messages[idx].text = currentText;
      this.messages[idx].lines = currentText.split('\n');
      this.redrawMessages();
      await new Promise(r => setTimeout(r, 40 + Math.random() * 40));
    }

    this.isBotTyping = false;
    this.redrawInput();
  }
}

let activeChatInstance = null;

process.on('SIGINT', () => {
  if (activeChatInstance) {
    if (typeof activeChatInstance.customSigintHandler === 'function') {
      activeChatInstance.customSigintHandler(activeChatInstance);
      return;
    }
    activeChatInstance.cleanup();
    activeChatInstance = null;
  } else {
    try {
      process.stdout.write('\x1b[<u');
      process.stdout.write('\x1b[>4;0m');
      process.stdout.write('\x1b[2J\x1b[3J\x1b[0;0H');
      process.stdout.write('\x1b[?25h');
      process.stdout.write('\x1b[0m');
    } catch (_) { /* ignore */ }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit();
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const chat = new ChatHUD();
  chat.start();
}

export default ChatHUD;