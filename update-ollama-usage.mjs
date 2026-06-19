import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const WebSocket = require('C:/Users/Education/AppData/Roaming/npm/node_modules/pm2/node_modules/ws/index.js');

const SNAPSHOT_PATH = 'C:/Users/Education/AppData/Local/Temp/ollama-usage-snapshot.json';
const DEBUG_PORT = 9222;
const WS_TIMEOUT_MS = 15_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function getPageList() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
  });
}

async function getPageText(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await withTimeout(
    new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    WS_TIMEOUT_MS,
    'WebSocket connect',
  );

  function send(method, params = {}) {
    const id = Math.floor(Math.random() * 1e9);
    return withTimeout(
      new Promise((resolve, reject) => {
        const handler = (msg) => {
          const data = JSON.parse(msg);
          if (data.id === id) {
            ws.off('message', handler);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      }),
      WS_TIMEOUT_MS,
      `CDP ${method}`,
    );
  }

  await send('Runtime.enable');
  const result = await send('Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true,
  });
  ws.close();
  return result.result.value;
}

function parseResetToDate(text) {
  const t = text.toLowerCase();
  let ms = Date.now();
  const hourMatch = t.match(/resets in (\d+) hours?/);
  if (hourMatch) {
    ms += parseInt(hourMatch[1], 10) * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  }
  const dayMatch = t.match(/resets in (\d+) days?/);
  if (dayMatch) {
    ms += parseInt(dayMatch[1], 10) * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function parsePercent(text) {
  const m = text.match(/(\d+(?:\.\d+)?)% used/);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseUsage(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const sessionIndex = lines.indexOf('Session usage');
  const weeklyIndex = lines.indexOf('Weekly usage');

  const sessionText = sessionIndex >= 0 ? lines[sessionIndex + 1] : '';
  const sessionReset = sessionIndex >= 0
    ? lines.slice(sessionIndex + 2, sessionIndex + 6).find((l) => l.toLowerCase().includes('resets in')) || ''
    : '';
  const weeklyText = weeklyIndex >= 0 ? lines[weeklyIndex + 1] : '';
  const weeklyReset = weeklyIndex >= 0
    ? lines.slice(weeklyIndex + 2, weeklyIndex + 6).find((l) => l.toLowerCase().includes('resets in')) || ''
    : '';

  const balanceLine = lines.find((l) => l.startsWith('$')) || '$0';
  const balance = balanceLine.replace('$', '').trim();

  return {
    fiveHour: parsePercent(sessionText),
    fiveHourResetAt: parseResetToDate(sessionReset),
    sevenDay: parsePercent(weeklyText),
    sevenDayResetAt: parseResetToDate(weeklyReset),
    balanceLabel: `Bal: $${balance}`,
  };
}

async function main() {
  const pages = await getPageList();
  const page = pages.find((p) => p?.url?.includes('ollama.com/settings'));
  if (!page) {
    throw new Error('Ollama settings page not found on debug port ' + DEBUG_PORT);
  }

  const text = await getPageText(page.webSocketDebuggerUrl);
  const usage = parseUsage(text);

  const snapshot = {
    updated_at: new Date().toISOString(),
    five_hour: {
      used_percentage: usage.fiveHour,
      resets_at: usage.fiveHourResetAt,
    },
    seven_day: {
      used_percentage: usage.sevenDay,
      resets_at: usage.sevenDayResetAt,
    },
    balance_label: usage.balanceLabel,
  };

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log('Updated', SNAPSHOT_PATH);
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
