import { ensureSettingsWindow } from './ollama-debug-utils.mjs';

async function readStdinJson() {
  if (process.stdin.isTTY) return undefined;
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : undefined);
      } catch {
        resolve(undefined);
      }
    });
    setTimeout(() => resolve(undefined), 5000);
  });
}

async function main() {
  const input = await readStdinJson();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
    originalLog(...args);
  };

  console.log('[Ollama] 正在查找/确保 Ollama settings 调试页面...');
  try {
    const result = await ensureSettingsWindow();
    if (result.opened) {
      console.log('[Ollama] 已打开 Ollama settings 调试窗口');
    } else {
      console.log('[Ollama] Ollama settings 调试窗口已存在');
    }
  } catch (err) {
    console.log(`[Ollama] 确保窗口失败：${err.message}`);
  }

  const systemMessage = logs.join('\n');
  const output = { systemMessage };
  if (input?.hookSpecificOutput?.hookEventName === 'SessionStart') {
    output.hookSpecificOutput = { hookEventName: 'SessionStart' };
  }
  console.log = originalLog;
  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error('Failed to ensure Ollama settings window:', err.message);
  process.exit(1);
});
