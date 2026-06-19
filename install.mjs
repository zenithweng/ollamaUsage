#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import readline from 'node:readline';

const REPO_URL = 'https://github.com/zenithweng/ollamaUsage.git';
const DEBUG_PORT = 9222;
const EDGE_EXE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const SNAPSHOT_PATH = path.join(os.tmpdir(), 'ollama-usage-snapshot.json');

function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(stderr || `${command} exited ${code}`));
      else resolve(stdout);
    });
  });
}

function prompt(question, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function getNodeExe() {
  const candidates = [
    process.execPath,
    'D:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files\\nodejs\\node.exe',
    path.join(os.homedir(), 'nvm-root', 'node.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getEdgeExe() {
  for (const c of EDGE_EXE_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  const regPaths = [
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
  ];
  for (const reg of regPaths) {
    try {
      const out = execSync(`powershell -NoProfile -Command "(Get-ItemProperty '${reg}').'(Default)'"`).toString().trim();
      if (out && fs.existsSync(out)) return out;
    } catch {}
  }
  return null;
}

function execSync(cmd) {
  return require('node:child_process').execSync(cmd, { windowsHide: true });
}

async function checkNodeVersion(nodeExe) {
  try {
    const out = await exec(nodeExe, ['--version']);
    const v = out.trim();
    const major = parseInt(v.replace(/^v/, '').split('.')[0], 10);
    return { ok: major >= 18, version: v, major };
  } catch {
    return { ok: false };
  }
}

function isPortListening(port = DEBUG_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function askRepoDir() {
  const defaultDir = path.join(os.homedir(), 'ollamaUsage');
  const answer = await prompt('安装目录', defaultDir);
  return path.resolve(answer);
}

async function main() {
  console.log('=== Ollama Usage 安装程序 ===');

  const nodeExe = getNodeExe();
  if (!nodeExe) {
    console.error('未找到 node.exe。请先安装 Node.js 18+：https://nodejs.org/');
    process.exit(1);
  }
  const nodeCheck = await checkNodeVersion(nodeExe);
  if (!nodeCheck.ok) {
    console.error(`Node.js 版本过低：${nodeCheck.version || 'unknown'}，需要 18+`);
    process.exit(1);
  }
  console.log(`Node.js: ${nodeCheck.version} (${nodeExe})`);

  const edgeExe = getEdgeExe();
  if (!edgeExe) {
    console.error('未找到 Microsoft Edge。本工具依赖 Edge 调试端口。');
    process.exit(1);
  }
  console.log(`Edge: ${edgeExe}`);

  if (!(await isPortListening(DEBUG_PORT))) {
    console.log('提示：调试端口 9222 未打开，安装后首次启动 Claude Code 时会自动打开 Edge。');
  }

  const installDir = await askRepoDir();
  if (fs.existsSync(installDir)) {
    const files = fs.readdirSync(installDir);
    if (files.length > 0) {
      const overwrite = await prompt(`目录 ${installDir} 已存在且非空，是否覆盖/更新？(y/n)`, 'y');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('安装已取消');
        process.exit(0);
      }
    }
  }

  console.log(`克隆仓库到 ${installDir}...`);
  await exec('git', ['clone', REPO_URL, installDir], { stdio: 'inherit' });

  const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'OllamaEdgeDebug');
  fs.mkdirSync(userDataDir, { recursive: true });

  const globalClaudeDir = path.join(os.homedir(), '.claude');
  const globalSettingsPath = path.join(globalClaudeDir, 'settings.json');
  fs.mkdirSync(globalClaudeDir, { recursive: true });

  const newHook = {
    type: 'command',
    command: `"${nodeExe}" "${path.join(installDir, 'ensure-ollama-settings.mjs')}"`,
  };

  let settings = { hooks: { SessionStart: [] } };
  if (fs.existsSync(globalSettingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    } catch (e) {
      console.warn('读取全局 settings.json 失败，将使用默认配置');
    }
  }
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

  const alreadyExists = settings.hooks.SessionStart.some(
    (h) => h?.type === 'command' && h.command?.includes('ensure-ollama-settings'),
  );
  if (!alreadyExists) {
    settings.hooks.SessionStart.push({ hooks: [newHook] });
  }

  fs.writeFileSync(globalSettingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  const projectClaudeDir = path.join(installDir, '.claude');
  fs.mkdirSync(projectClaudeDir, { recursive: true });

  const projectHooks = {
    hooks: [
      {
        name: 'update-ollama-usage-hud',
        event: 'user_prompt_submit',
        command: [nodeExe, path.join(installDir, 'ollama-usage-hud.mjs')],
      },
    ],
  };
  fs.writeFileSync(path.join(projectClaudeDir, 'hooks.json'), JSON.stringify(projectHooks, null, 2) + '\n', 'utf8');

  const projectSettings = {
    permissions: {
      allow: [
        'mcp__plugin_context-mode_context-mode__ctx_execute',
        `Bash(${nodeExe} *)`,
        'Bash(powershell *)',
        'WebSearch',
        'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index',
        'mcp__plugin_context-mode_context-mode__ctx_search',
      ],
    },
  };
  fs.writeFileSync(path.join(projectClaudeDir, 'settings.local.json'), JSON.stringify(projectSettings, null, 2) + '\n', 'utf8');

  const snapshotDir = path.dirname(SNAPSHOT_PATH);
  fs.mkdirSync(snapshotDir, { recursive: true });

  console.log('\n安装完成：');
  console.log(`- 代码目录：${installDir}`);
  console.log(`- 全局 hook：${globalSettingsPath} (SessionStart)`);
  console.log(`- 项目 hook：${path.join(projectClaudeDir, 'hooks.json')}`);
  console.log(`- Edge 用户数据目录：${userDataDir}`);
  console.log('\n请重新启动 Claude Code，并打开位于该目录下的项目：');
  console.log(`  cd ${installDir}`);
}

main().catch((err) => {
  console.error('安装失败：', err.message);
  process.exit(1);
});
