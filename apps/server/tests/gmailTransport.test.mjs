import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMailConfig, getGmailConfig, buildGmailRaw, createGmailTransport } from '../mailTransport.mjs';
import { authorizeGmail, writeGmailEnvironment } from '../../../scripts/gmail-authorize.mjs';

const env = { GMAIL_CLIENT_ID: 'fixture-client', GMAIL_CLIENT_SECRET: 'fixture-secret', GMAIL_REFRESH_TOKEN: 'fixture-refresh', GMAIL_SENDER_EMAIL: 'qc.fixture@gmail.com', GMAIL_SENDER_NAME: 'Đội ngũ QC — WZ System' };
const config = getGmailConfig(env);
const payload = { from: config.from, to: ['freelancer@example.com'], subject: '👋 Ping nhẹ: Bộ thử — Chapter 1', text: 'Chào An, chốt file nhé!', html: '<p>Chào An, <strong>chốt file nhé!</strong></p>' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const decodeWords = (header) => header.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, encoded) => Buffer.from(encoded, 'base64').toString('utf8')).replace(/\r\n /g, '');

test('Gmail is the default; explicit Resend remains available and missing secrets are identified', () => {
  assert.equal(getMailConfig(env).provider, 'gmail');
  assert.equal(getMailConfig({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'fixture', RESEND_FROM: 'qc@example.com' }).provider, 'resend');
  assert.throws(() => getMailConfig({ RESEND_API_KEY: 'fixture' }), /GMAIL_CLIENT_ID/);
  assert.throws(() => getMailConfig({ ...env, MAIL_PROVIDER: 'smtp' }), /MAIL_PROVIDER/);
  for (const changes of [{ GMAIL_SENDER_EMAIL: 'x@example.com' }, { GMAIL_SENDER_EMAIL: 'x@gmail.com\r\nBcc: stolen@example.com' }, { GMAIL_SENDER_NAME: 'Name\r\nBcc: stolen@example.com' }]) {
    assert.throws(() => getGmailConfig({ ...env, ...changes }));
  }
});

test('MIME preserves Vietnamese/emoji and HTML/text, folds headers and rejects injection', () => {
  const subject = payload.subject.repeat(8);
  const raw = buildGmailRaw({ ...payload, subject }, config, { idempotencyKey: 'reminder/fixture', now: 0 });
  assert.match(raw, /^[a-zA-Z0-9_-]+$/);
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const header = mime.split('\r\n\r\n')[0];
  assert.equal(decodeWords(header.match(/Subject: ([\s\S]+?)\r\nDate:/)[1]), subject);
  assert.ok(decodeWords(header).includes(`From: ${config.from}`));
  assert.ok(header.split('\r\n').every((line) => line.length < 998));
  const parts = [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]+?)\r\n--wz_/g)];
  assert.equal(Buffer.from(parts[0][1], 'base64').toString('utf8'), payload.text);
  assert.equal(Buffer.from(parts[1][1], 'base64').toString('utf8'), payload.html);
  assert.equal(buildGmailRaw({ ...payload, subject }, config, { idempotencyKey: 'reminder/fixture', now: 0 }), raw);
  for (const changes of [{ from: 'other@gmail.com' }, { subject: 'hello\r\nBcc: stolen@example.com' }, { to: ['x@example.com\r\nBcc: stolen@example.com'] }, { to: [] }]) {
    assert.throws(() => buildGmailRaw({ ...payload, ...changes }, config));
  }
});

test('HTTPS transport shares/caches refresh tokens, refreshes expiry and preserves MIME', async () => {
  let time = 1_000_000;
  const calls = [];
  const send = createGmailTransport({ now: () => time, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('oauth2')) { await new Promise((resolve) => setTimeout(resolve, 1)); return json({ access_token: 'access-only', expires_in: 3600 }); }
    assert.equal(options.headers.Authorization, 'Bearer access-only');
    assert.ok(!options.headers['Idempotency-Key']);
    assert.match(url, /qc.fixture%40gmail.com\/messages\/send$/);
    return json({ id: 'gmail-id' });
  } });
  await Promise.all([send(payload, { config }), send(payload, { config })]);
  assert.equal(calls.filter((call) => call.url.includes('oauth2')).length, 1);
  await send(payload, { config });
  assert.equal(calls.length, 4);
  time += 3_550_000;
  await send(payload, { config });
  assert.equal(calls.filter((call) => call.url.includes('oauth2')).length, 2);
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), env.GMAIL_REFRESH_TOKEN);
  await send(payload, { config: { ...config, refreshToken: 'rotated' } });
  assert.equal(calls.filter((call) => call.url.includes('oauth2')).length, 3);
});

test('401 refreshes once; confirmed limits retry and ambiguous POST results never retry', async () => {
  for (const [status, reason, retryable, uncertain] of [[400, 'badRequest', false, false], [403, 'forbidden', false, false], [403, 'userRateLimitExceeded', true, false], [429, 'rateLimitExceeded', true, false], [503, 'backendError', false, true], [200, '', false, true]]) {
    const send = createGmailTransport({ fetchImpl: async (url) => url.includes('oauth2') ? json({ access_token: 'access', expires_in: 3600 })
      : json({ error: { message: 'secret-provider-message', errors: [{ reason }] } }, status, { 'Retry-After': '120' }) });
    await assert.rejects(send(payload, { config }), (error) => error.retryable === retryable && error.uncertain === uncertain && error.retryAfterMs === 120_000 && !error.message.includes('secret-provider-message'));
  }
  let refreshes = 0;
  let posts = 0;
  const send = createGmailTransport({ fetchImpl: async (url) => url.includes('oauth2')
    ? (refreshes++, json({ access_token: `access-${refreshes}`, expires_in: 3600 }))
    : (++posts === 1 ? json({}, 401) : json({ id: 'accepted' })) });
  assert.equal(await send(payload, { config }), 'accepted');
  assert.equal(refreshes, 2);
  assert.equal(posts, 2);
  const timeout = createGmailTransport({ fetchImpl: async (url) => {
    if (url.includes('oauth2')) return json({ access_token: 'access', expires_in: 3600 });
    throw new Error('network');
  } });
  await assert.rejects(timeout(payload, { config }), (error) => error.uncertain && !error.retryable);
});

test('token failures are safe to retry; revoked OAuth fails with actionable, secret-free errors', async () => {
  for (const status of [400, 401, 429, 503]) {
    let posts = 0;
    const send = createGmailTransport({ fetchImpl: async (url) => {
      if (url.includes('oauth2')) return json({ error: 'invalid_grant', error_description: env.GMAIL_REFRESH_TOKEN }, status);
      posts++; return json({ id: 'unexpected' });
    } });
    await assert.rejects(send(payload, { config }), (error) => !error.uncertain && error.retryable === (status >= 429) && !error.message.includes(env.GMAIL_REFRESH_TOKEN));
    assert.equal(posts, 0);
  }
  const send = createGmailTransport({ fetchImpl: async () => { throw new Error(env.GMAIL_CLIENT_SECRET); } });
  await assert.rejects(send(payload, { config }), (error) => error.retryable && !error.uncertain && !error.message.includes(env.GMAIL_CLIENT_SECRET));
});

const credentials = { installed: { client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET } };
test('local OAuth checks state, PKCE, scope and authorized sender without printing tokens', async () => {
  let authorization;
  let tokenForm;
  const result = await authorizeGmail({ credentials, email: config.email, fetchImpl: async (url, options) => {
    if (url.includes('oauth2')) {
      tokenForm = new URLSearchParams(options.body);
      assert.equal(createHash('sha256').update(tokenForm.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
      return json({ access_token: 'access', refresh_token: 'refresh', scope: 'openid email https://www.googleapis.com/auth/gmail.send' });
    }
    return json({ email: config.email, email_verified: true });
  }, onAuthorizationUrl: async (value) => {
    authorization = new URL(value);
    assert.equal(authorization.searchParams.get('access_type'), 'offline');
    assert.equal(authorization.searchParams.get('prompt'), 'consent');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1');
    callback.search = new URLSearchParams({ state: 'wrong-state', code: 'invalid' });
    assert.equal((await fetch(callback)).status, 400);
    callback.search = new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fixture-code' });
    assert.equal((await fetch(callback)).status, 200);
  } });
  assert.equal(result.GMAIL_REFRESH_TOKEN, 'refresh');
  assert.equal(tokenForm.get('code'), 'fixture-code');
});

test('local OAuth rejects wrong account, missing send permission, denial and timeout', async () => {
  for (const mode of ['account', 'scope', 'denied', 'timeout']) {
    await assert.rejects(authorizeGmail({ credentials, email: config.email, timeoutMs: mode === 'timeout' ? 10 : 1000,
      fetchImpl: async (url) => url.includes('oauth2') ? json({ access_token: 'access', refresh_token: 'refresh', scope: mode === 'scope' ? 'email' : 'https://www.googleapis.com/auth/gmail.send' })
        : json({ email: 'wrong@gmail.com', email_verified: true }),
      onAuthorizationUrl: async (value) => {
        if (mode === 'timeout') return;
        const url = new URL(value);
        const callback = new URL(url.searchParams.get('redirect_uri'));
        callback.search = new URLSearchParams({ state: url.searchParams.get('state'), ...(mode === 'denied' ? { error: 'access_denied' } : { code: 'fixture-code' }) });
        await fetch(callback);
      }
    }), mode === 'account' ? /khác Gmail/ : mode === 'scope' ? /gmail.send/ : mode === 'denied' ? /chưa cấp quyền/ : /Hết thời gian/);
  }
  await assert.rejects(authorizeGmail({ credentials: { web: credentials.installed }, email: config.email }), /Desktop app/);
});

test('OAuth environment file contains deployment variables and refuses overwrites/injection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qc-gmail-test-'));
  const file = join(directory, '.gmail-oauth.env');
  try {
    await writeGmailEnvironment(file, env);
    const content = await readFile(file, 'utf8');
    assert.ok(content.includes('MAIL_PROVIDER=gmail'));
    assert.ok(content.includes('GMAIL_REFRESH_TOKEN="fixture-refresh"'));
    await assert.rejects(writeGmailEnvironment(file, env), { code: 'EEXIST' });
    await assert.rejects(writeGmailEnvironment(join(directory, 'invalid.env'), { GMAIL_REFRESH_TOKEN: 'token\nINJECT=x' }), /không hợp lệ/);
  } finally { await unlink(file); await rmdir(directory); }
});
