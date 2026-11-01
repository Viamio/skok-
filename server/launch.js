// Uruchamia serwer gry i restartuje go po aktualizacji (kod wyjścia 42).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js');
function run() {
  const child = current = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, SKOK_LAUNCHER: '1' } });
  child.on('exit', (code) => {
    if (code === 42) { console.log('\n  Restart po aktualizacji…\n'); setTimeout(run, 300); }
    else process.exit(code ?? 0);
  });
}
let current = null;
const _run = run;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { current?.kill(sig); process.exit(0); });
run();
