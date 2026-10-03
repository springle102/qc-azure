import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Chạy lệnh này bằng `npm run dev` từ thư mục gốc của dự án.');
  process.exit(1);
}

const services = [
  { name: 'server', cwd: `${root}apps/server` },
  { name: 'client', cwd: `${root}apps/client` }
];
const children = [];
let shuttingDown = false;

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const service of services) {
  const child = spawn(process.execPath, [npmCli, 'run', 'dev'], {
    cwd: service.cwd,
    stdio: 'inherit',
    env: process.env
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`Không thể chạy ${service.name}: ${error.message}`);
    process.exitCode = 1;
    stopAll();
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    process.exitCode = code || 1;
    console.error(`${service.name} đã dừng; đang dừng các dịch vụ local còn lại.`);
    stopAll();
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
