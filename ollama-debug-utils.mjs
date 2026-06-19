import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

export const DEBUG_PORT = 9222;
const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USER_DATA_DIR = 'C:\\Users\\Education\\AppData\\Local\\OllamaEdgeDebug';

export function isPortListening(port = DEBUG_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function getPageList(port = DEBUG_PORT) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout getting page list'));
    });
  });
}

export function hasSettingsPage(pages) {
  return pages.some((p) => p?.url?.includes('ollama.com/settings'));
}

export async function findSettingsPage(port = DEBUG_PORT) {
  const pages = await getPageList(port);
  return pages.find((p) => p?.url?.includes('ollama.com/settings')) || null;
}

export function startEdge(port = DEBUG_PORT) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    const edgeArg = EDGE_EXE.replace(/'/g, "''");
    const command = `Start-Process '${edgeArg}' -ArgumentList '--remote-debugging-port=${port}','--user-data-dir="${USER_DATA_DIR}"','https://ollama.com/settings'`;
    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command,
    ];
    const child = spawn('powershell', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`PowerShell exited with code ${code}: ${stderr}`));
      else resolve();
    });
  });
}

export async function ensureSettingsWindow(port = DEBUG_PORT, maxWaitSec = 15) {
  console.log('[Ollama] 正在检查调试端口...');
  if (await isPortListening(port)) {
    console.log('[Ollama] 调试端口已打开，正在查找 ollama.com/settings 页面...');
    const pages = await getPageList(port);
    if (hasSettingsPage(pages)) {
      console.log('[Ollama] 已找到 ollama.com/settings 页面。');
      return { opened: false, reason: 'already open' };
    }
    console.log('[Ollama] 未找到 ollama.com/settings 页面，准备启动 Edge。');
  } else {
    console.log('[Ollama] 调试端口未打开，准备启动 Edge。');
  }

  console.log('[Ollama] Ollama settings web 页面即将打开，请等待登录并加载用量信息。');
  await startEdge(port);

  console.log('[Ollama] Edge 已启动，正在等待调试端口就绪...');
  for (let i = 0; i < maxWaitSec; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isPortListening(port)) {
      const pages = await getPageList(port);
      if (hasSettingsPage(pages)) {
        console.log('[Ollama] Web 页面已打开（ollama.com/settings），调试端口就绪。');
        return { opened: true, reason: 'started Edge' };
      }
    }
  }

  throw new Error('Ollama settings window did not become available after startup');
}
