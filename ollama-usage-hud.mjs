import fs from 'node:fs';
import { spawn } from 'node:child_process';

const SNAPSHOT_PATH = 'C:/Users/Education/AppData/Local/Temp/ollama-usage-snapshot.json';
const MAX_AGE_MS = 120_000;

function formatHud(snapshot) {
  const fh = snapshot?.five_hour?.used_percentage;
  const sd = snapshot?.seven_day?.used_percentage;
  const bal = snapshot?.balance_label || '';
  const parts = [];
  if (typeof fh === 'number') parts.push(`5h:${fh}%`);
  if (typeof sd === 'number') parts.push(`7d:${sd}%`);
  if (bal) parts.push(bal);
  if (parts.length === 0) return 'Ollama usage: unavailable';
  return `[Ollama] ${parts.join(' | ')}`;
}

async function refreshSnapshot() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'D:/Program Files/nodejs/node.exe',
      ['E:/ai/work/ollamausage/update-ollama-usage.mjs'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(stderr || `refresh exited ${code}`));
      else resolve(stdout);
    });
  });
}

async function main() {
  let snapshot = null;
  let stale = false;

  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      const stat = fs.statSync(SNAPSHOT_PATH);
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
      stale = Date.now() - stat.mtimeMs > MAX_AGE_MS;
    } catch (e) {
      stale = true;
    }
  } else {
    stale = true;
  }

  if (stale) {
    try {
      await refreshSnapshot();
      snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch (e) {
      // keep old snapshot if refresh failed
    }
  }

  console.log(formatHud(snapshot));
}

main().catch((err) => {
  console.error('Ollama HUD error:', err.message);
  process.exit(1);
});
