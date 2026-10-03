import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] || 'up';
const commands = {
  up: ['up', '-d', '--build', '--wait', '--wait-timeout', '180'],
  down: ['down'],
  logs: ['logs', '--follow', '--tail', '100'],
  status: ['ps'],
};

function readEnvValue(source, key) {
  const match = source.match(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(.*)$`, 'm'));
  if (!match) return '';
  const value = match[1].trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    return value.slice(1, value.indexOf(value[0], 1));
  }
  return value.replace(/\s+#.*$/, '').trim();
}

try {
  if (!commands[command]) throw new Error('Usage: node scripts/docker.mjs up|down|logs|status');
  const envFile = join(root, 'apps/server/.env');
  if (!existsSync(envFile)) {
    throw new Error('Create apps/server/.env from apps/server/.env.example before starting Docker.');
  }

  const env = { ...process.env };
  const args = ['compose', '-f', 'compose.yaml'];
  if (command === 'up') {
    const source = readFileSync(envFile, 'utf8');
    const googleFile = env.GOOGLE_SERVICE_ACCOUNT_HOST_FILE || readEnvValue(source, 'GOOGLE_SERVICE_ACCOUNT_FILE');
    const inlineGoogle = readEnvValue(source, 'GOOGLE_SERVICE_ACCOUNT_JSON') || readEnvValue(source, 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
    if (googleFile && !inlineGoogle) {
      // Match the existing backend's resolution of relative paths from apps/server.
      const hostFile = isAbsolute(googleFile) ? googleFile : resolve(root, 'apps/server', googleFile);
      if (!existsSync(hostFile)) throw new Error('The configured Google service account file does not exist.');
      env.GOOGLE_SERVICE_ACCOUNT_HOST_FILE = hostFile;
      args.push('-f', 'compose.google.yaml');
    }
  }
  args.push(...commands[command]);

  // Docker Desktop per-user installs may not be on the current terminal's PATH.
  const candidates = process.platform === 'win32' ? [
    join(env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
    join(env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
  ] : [];
  const docker = candidates.find((path) => existsSync(path)) || 'docker';
  const child = spawn(docker, args, { cwd: root, env, stdio: 'inherit', shell: false });
  child.on('error', (error) => {
    console.error(`Unable to run Docker: ${error.message}. Install and start Docker Desktop first.`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
