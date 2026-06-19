import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DAEMON_SCRIPT = 'E:/ai/work/ollamausage/ollama-usage-daemon.mjs';
const NODE_EXE = 'D:/Program Files/nodejs/node.exe';
const PID_FILE = 'C:/Users/Education/AppData/Local/Temp/ollama-usage-daemon.pid';
const LOG_PATH = 'C:/Users/Education/AppData/Local/Temp/ollama-usage-daemon.log';

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}`;
  fs.appendFileSync(LOG_PATH, line + '\n', 'utf8');
}

function isDaemonRunning() {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (isDaemonRunning()) {
  log('Daemon already running');
  process.exit(0);
}

log('Starting daemon');

const out = fs.openSync(LOG_PATH, 'a');
const err = fs.openSync(LOG_PATH, 'a');

const child = spawn(
  NODE_EXE,
  [DAEMON_SCRIPT],
  {
    detached: true,
    stdio: ['ignore', out, err],
  },
);

child.unref();
fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
log('Daemon started with PID', child.pid);
