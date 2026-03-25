// Usurper Reborn — Electron Renderer
// Phase 1: xterm.js terminal connecting to game server via WebSocket

// xterm.js loaded via script tags — UMD globals
const Terminal = window.Terminal;
const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;
const WebLinksAddon = window.WebLinksAddon?.WebLinksAddon || window.WebLinksAddon;

// Terminal setup
const term = new Terminal({
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
  fontSize: 14,
  theme: {
    background: '#000000',
    foreground: '#c0c0c0',
    cursor: '#c0a050',
    cursorAccent: '#000000',
    selectionBackground: '#3a3a5a',
    selectionForeground: '#ffffff',
    black: '#000000',
    red: '#aa0000',
    green: '#00aa00',
    yellow: '#aa5500',
    blue: '#5555ff',
    magenta: '#aa00aa',
    cyan: '#00aaaa',
    white: '#c0c0c0',
    brightBlack: '#555555',
    brightRed: '#ff5555',
    brightGreen: '#55ff55',
    brightYellow: '#ffff55',
    brightBlue: '#5555ff',
    brightMagenta: '#ff55ff',
    brightCyan: '#55ffff',
    brightWhite: '#ffffff'
  },
  cursorBlink: true,
  scrollback: 5000,
  allowProposedApi: true
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.loadAddon(new WebLinksAddon());

// Mount terminal
const container = document.getElementById('terminal');
term.open(container);
fitAddon.fit();

// Resize handling
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
});
resizeObserver.observe(container);

// Connection state
let ws = null;
let reconnectTimer = null;
const statusEl = document.getElementById('connection-status');

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls;
}

// WebSocket connection
async function connect() {
  const config = await window.usurper.getConfig();

  if (ws) {
    ws.close();
    ws = null;
  }

  setStatus('Connecting...', 'connecting');

  ws = new WebSocket(config.wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log('WebSocket connected to', config.wsUrl);
    setStatus('Connected', 'connected');
    term.focus();

    // Send terminal size (server may need this)
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }
  };

  ws.onmessage = (event) => {
    // Feed to xterm.js (raw terminal)
    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data);
      term.write(bytes);
      parser.feed(bytes);
    } else {
      term.write(event.data);
      parser.feed(event.data);
    }
  };

  ws.onclose = (event) => {
    console.log('WebSocket closed:', event.code, event.reason);
    setStatus('Disconnected', 'disconnected');
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 3000);
    }
  };

  ws.onerror = (err) => {
    setStatus('Connection error', 'disconnected');
    console.error('WebSocket error:', err.message || err);
  };
}

// Send terminal input to server
term.onData((data) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
});

// ANSI Parser — Phase 2
const parser = new AnsiParser();
const parsedOutput = document.getElementById('parsed-output');
const parsedPanel = document.getElementById('parsed-panel');
let showParsed = false;

// Graphical Renderer — Phase 3
const graphicalView = document.getElementById('graphical-view');
const terminalContainer = document.getElementById('terminal-container');
const viewToggle = document.getElementById('view-toggle');
const htmlRenderer = new HtmlRenderer(graphicalView);
let graphicalMode = false;

// Send input from graphical view
htmlRenderer.setupInput((data) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
});

function setViewMode(graphical) {
  graphicalMode = graphical;
  terminalContainer.style.display = graphical ? 'none' : 'block';
  graphicalView.classList.toggle('active', graphical);
  viewToggle.textContent = graphical ? 'Graphical' : 'Terminal';
  if (!graphical) {
    fitAddon.fit();
    term.focus();
  } else {
    htmlRenderer.inputEl.focus();
  }
}

// Toggle view with F10 or button click
window.addEventListener('keydown', (e) => {
  if (e.key === 'F10') {
    setViewMode(!graphicalMode);
    e.preventDefault();
    e.stopPropagation();
  }
  if (e.key === 'F9') {
    showParsed = !showParsed;
    parsedPanel.classList.toggle('visible', showParsed);
    if (!graphicalMode) fitAddon.fit();
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

viewToggle.addEventListener('click', () => setViewMode(!graphicalMode));

// Feed parsed lines to both debug panel and graphical renderer
parser.onLine = (spans) => {
  // Graphical renderer — always render to keep output and state current
  const classified = htmlRenderer.matcher.classify(spans);
  htmlRenderer.renderLine(classified);

  // Debug panel
  if (!showParsed) return;
  const lineEl = document.createElement('div');
  lineEl.className = 'parsed-line';

  // Show classification tag
  const tagEl = document.createElement('span');
  tagEl.style.color = '#555';
  tagEl.style.fontSize = '9px';
  tagEl.textContent = `[${classified.type}] `;
  lineEl.appendChild(tagEl);

  for (const span of spans) {
    const spanEl = document.createElement('span');
    spanEl.textContent = span.text;
    spanEl.style.color = span.fg;
    if (span.bold) spanEl.style.fontWeight = 'bold';
    if (span.dim) spanEl.style.opacity = '0.6';
    lineEl.appendChild(spanEl);
  }
  parsedOutput.appendChild(lineEl);
  while (parsedOutput.children.length > 200) {
    parsedOutput.removeChild(parsedOutput.firstChild);
  }
  parsedOutput.scrollTop = parsedOutput.scrollHeight;
};

parser.onClearScreen = () => {
  htmlRenderer.clearScreen();
  if (showParsed) parsedOutput.innerHTML = '';
};

// Start connection
connect();

// Focus terminal on window focus
window.addEventListener('focus', () => {
  term.focus();
});
