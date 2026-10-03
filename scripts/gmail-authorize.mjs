import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getGmailConfig } from '../apps/server/mailTransport.mjs';

class GmailSetupError extends Error {}

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

// Local bootstrap only: no OAuth callback or credentials endpoint is exposed on Railway.
export async function authorizeGmail({ credentials, email, fetchImpl = fetch, timeoutMs = 300_000,
  onAuthorizationUrl = (url) => console.log(`Mở đường dẫn này trên trình duyệt và cấp quyền cho Gmail gửi mail:\n${url}`) }) {
  const client = credentials?.installed;
  if (!client?.client_id || !client?.client_secret) throw new GmailSetupError('Cần file JSON OAuth client loại Desktop app (không phải Service Account).');
  getGmailConfig({ GMAIL_CLIENT_ID: client.client_id, GMAIL_CLIENT_SECRET: client.client_secret, GMAIL_REFRESH_TOKEN: 'validation-only', GMAIL_SENDER_EMAIL: email });
  email = email.trim().toLowerCase();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  let resolveCode;
  let rejectCode;
  let received = false;
  const codePromise = new Promise((resolveValue, reject) => { resolveCode = resolveValue; rejectCode = reject; });
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method !== 'GET' || url.pathname !== '/oauth/callback') { response.writeHead(404); response.end('Không tìm thấy.'); return; }
    const returnedState = Buffer.from(url.searchParams.get('state') || '');
    const expected = Buffer.from(state);
    if (received || returnedState.length !== expected.length || !timingSafeEqual(returnedState, expected)) {
      response.writeHead(400); response.end('Phiên cấp quyền không hợp lệ.'); return;
    }
    received = true;
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      response.writeHead(400); response.end('Chưa cấp quyền gửi Gmail. Quay lại terminal.');
      rejectCode(new GmailSetupError('Google chưa cấp quyền gửi Gmail.')); return;
    }
    response.end('Đã nhận mã cấp quyền. Quay lại terminal để xem kết quả; bạn có thể đóng tab này.');
    resolveCode(url.searchParams.get('code'));
  });
  let timer;
  try {
    await new Promise((resolveValue, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveValue); });
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
      scope: `${SEND_SCOPE} openid email`, access_type: 'offline', prompt: 'consent', login_hint: email, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    timer = setTimeout(() => rejectCode(new GmailSetupError('Hết thời gian chờ cấp quyền. Chạy lại gmail:authorize.')), timeoutMs);
    // Catch callback rejection even if an automation hook is still running.
    codePromise.catch(() => {});
    await onAuthorizationUrl(url.href);
    const code = await codePromise;
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, code, code_verifier: verifier,
        redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString() });
    const token = await response.json().catch(() => null);
    if (!response.ok || !token?.refresh_token || !token?.access_token) throw new GmailSetupError('Google chưa cấp refresh token. Kiểm tra OAuth client, cấp đủ quyền rồi chạy lại.');
    if (!String(token.scope || '').split(' ').includes(SEND_SCOPE)) throw new GmailSetupError('Bạn chưa cấp quyền gmail.send. Chạy lại và chọn quyền gửi mail.');
    const identity = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
      signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const user = await identity.json().catch(() => null);
    if (!identity.ok || !user?.email_verified || user.email?.toLowerCase() !== email) throw new GmailSetupError('Tài khoản vừa cấp quyền khác Gmail gửi đã chọn. Chạy lại và chọn đúng tài khoản.');
    return { GMAIL_CLIENT_ID: client.client_id, GMAIL_CLIENT_SECRET: client.client_secret, GMAIL_REFRESH_TOKEN: token.refresh_token, GMAIL_SENDER_EMAIL: email };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolveValue) => server.close(resolveValue));
  }
}

export async function writeGmailEnvironment(output, values) {
  const quote = (value) => {
    if (/[\r\n\x00]/.test(String(value))) throw new GmailSetupError('Giá trị cấu hình Gmail không hợp lệ.');
    return JSON.stringify(String(value));
  };
  const content = ['# Secret: chỉ lưu cục bộ, không commit hoặc gửi qua chat.', 'MAIL_PROVIDER=gmail',
    ...Object.entries(values).map(([key, value]) => `${key}=${quote(value)}`), 'GMAIL_SENDER_NAME="WZ System"', ''].join('\n');
  await writeFile(output, content, { flag: 'wx', mode: 0o600 });
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--credentials', '--email', '--output'].includes(args[index]) || !args[index + 1]) throw new GmailSetupError('Dùng: npm run gmail:authorize -- --credentials "đường dẫn client.json" --email "gmail-của-bạn@gmail.com" [--output "đường dẫn file secret"]');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!options.credentials || !options.email) throw new GmailSetupError('Cần --credentials và --email. Xem docs/deployment.md phần Gmail API.');
  const output = resolve(options.output || '.gmail-oauth.env');
  try { await access(output); throw new GmailSetupError('File đích đã tồn tại. Chọn --output khác để tránh ghi đè secret.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const credentials = JSON.parse(await readFile(resolve(options.credentials), 'utf8'));
  const values = await authorizeGmail({ credentials, email: options.email });
  await writeGmailEnvironment(output, values);
  console.log(`Đã lưu cấu hình tại ${output}. Sao chép giá trị vào Railway Variables; terminal không in secret.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof GmailSetupError ? error.message : 'Không hoàn tất cấp quyền Gmail. Kiểm tra file OAuth Desktop app, Gmail gửi, quyền gmail.send, file đích chưa tồn tại và kết nối mạng. Xem docs/deployment.md.'); process.exitCode = 1; });
}
