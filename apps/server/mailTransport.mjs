import { createHash, randomUUID } from 'node:crypto';

export function getResendConfig(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.RESEND_FROM || '').trim();
  if (!apiKey || !from) throw Object.assign(new Error('Chưa cấu hình RESEND_API_KEY và RESEND_FROM để gửi mail.'), { statusCode: 503 });
  return { provider: 'resend', apiKey, from };
}

const gmailAddress = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(gmail|googlemail)\.com$/i;
const headerSafe = (value) => typeof value === 'string' && !/[\r\n\x00-\x1f\x7f]/.test(value);
const mailError = (message, details = {}) => Object.assign(new Error(message), { statusCode: 503, retryable: false, uncertain: false, ...details });

export function getGmailConfig(env = process.env) {
  const names = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER_EMAIL'];
  const missing = names.filter((name) => !String(env[name] || '').trim());
  if (missing.length) throw mailError(`Chưa cấu hình Gmail API: ${missing.join(', ')}.`);
  const email = String(env.GMAIL_SENDER_EMAIL).trim().toLowerCase();
  const name = String(env.GMAIL_SENDER_NAME || 'WZ System').trim();
  if (!gmailAddress.test(email) || !headerSafe(name) || name.length > 100) {
    throw mailError('GMAIL_SENDER_EMAIL phải là Gmail đã cấp quyền; GMAIL_SENDER_NAME không được chứa xuống dòng và dài quá 100 ký tự.');
  }
  return { provider: 'gmail', clientId: String(env.GMAIL_CLIENT_ID).trim(), clientSecret: String(env.GMAIL_CLIENT_SECRET).trim(),
    refreshToken: String(env.GMAIL_REFRESH_TOKEN).trim(), email, name, from: `${name} <${email}>` };
}

export function getMailConfig(env = process.env) {
  const provider = String(env.MAIL_PROVIDER || 'gmail').trim().toLowerCase();
  if (provider === 'gmail') return getGmailConfig(env);
  if (provider === 'resend') return getResendConfig(env);
  throw mailError('MAIL_PROVIDER phải là gmail hoặc resend.');
}

function retryAfterMs(response, now) {
  const value = response.headers.get('retry-after');
  return value === null ? 0 : /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - now) || 0;
}

// RFC 2047 words are short enough to fold without splitting UTF-8 characters.
function encodedHeader(value) {
  const chunks = [];
  let part = '';
  for (const character of String(value)) {
    if (Buffer.byteLength(part + character) > 42) { chunks.push(part); part = ''; }
    part += character;
  }
  if (part) chunks.push(part);
  return chunks.map((chunk) => `=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`).join('\r\n ');
}

export function buildGmailRaw(payload, config, { idempotencyKey, now = Date.now() } = {}) {
  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
  const validAddress = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (payload.from !== config.from || !headerSafe(payload.subject) || !payload.subject || payload.subject.length > 2000
    || !recipients.length || recipients.some((address) => !headerSafe(address) || !validAddress.test(address))) {
    throw mailError('Nội dung mail hoặc địa chỉ gửi/nhận không hợp lệ.');
  }
  const identity = createHash('sha256').update(idempotencyKey || randomUUID()).digest('hex');
  const boundary = `wz_${identity}`;
  const body = (content) => (Buffer.from(String(content || ''), 'utf8').toString('base64').match(/.{1,76}/g) || ['']).join('\r\n');
  const mime = [
    `From: ${encodedHeader(config.name)} <${config.email}>`, `To: ${recipients.join(', ')}`,
    `Subject: ${encodedHeader(payload.subject)}`, `Date: ${new Date(now).toUTCString()}`,
    // Message-ID is for tracing only. Gmail does NOT guarantee deduplication by this header.
    `Message-ID: <${identity}@${config.email.split('@')[1]}>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body(payload.text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body(payload.html || payload.text),
    `--${boundary}--`, ''
  ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}

export function createGmailTransport({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached;
  let refreshing;
  const keyFor = (config) => createHash('sha256').update(JSON.stringify([config.clientId, config.clientSecret, config.refreshToken])).digest('hex');
  async function token(config, force = false) {
    const key = keyFor(config);
    if (!force && cached?.key === key && cached.expiresAt > now() + 60_000) return cached.value;
    if (refreshing?.key === key) return refreshing.promise;
    const promise = (async () => {
      let response;
      let data;
      try {
        response = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }).toString()
        });
        data = await response.json().catch(() => null);
      } catch { throw mailError('Không kết nối được Google để làm mới quyền gửi mail.', { retryable: true }); }
      if (!response.ok || !data?.access_token || !(Number(data.expires_in) > 0)) {
        // Do not expose provider bodies: they can contain credentials or account details.
        throw mailError(response.status === 400 || response.status === 401
          ? 'Quyền gửi Gmail đã hết hiệu lực hoặc OAuth không hợp lệ. Chạy lại gmail:authorize và cập nhật Railway.'
          : `Google chưa cấp quyền gửi mail (HTTP ${response.status}).`,
        { retryable: response.status === 429 || response.status >= 500 || response.ok, retryAfterMs: retryAfterMs(response, now()) });
      }
      cached = { key, value: data.access_token, expiresAt: now() + Number(data.expires_in) * 1000 };
      return cached.value;
    })();
    refreshing = { key, promise };
    try { return await promise; } finally { if (refreshing?.promise === promise) refreshing = undefined; }
  }
  return async function sendGmailEmail(payload, { config = getGmailConfig(), idempotencyKey, now: sentAt = now() } = {}) {
    const raw = buildGmailRaw(payload, config, { idempotencyKey, now: sentAt });
    for (let attempt = 0; attempt < 2; attempt++) {
      const accessToken = await token(config, attempt > 0);
      let response;
      let data;
      try {
        // Addressing the authorized account explicitly prevents using a different Gmail sender.
        response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(config.email)}/messages/send`, {
          method: 'POST', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw })
        });
        data = await response.json().catch(() => null);
      } catch { throw mailError('Chưa xác nhận được kết quả gửi Gmail. Kiểm tra thư Đã gửi trước khi xử lý tiếp.', { statusCode: 502, uncertain: true }); }
      if (response.status === 401 && attempt === 0) { cached = undefined; continue; }
      if (response.ok && data?.id) return data.id;
      const reasons = (data?.error?.errors || []).map((error) => error.reason);
      const limited = response.status === 429 || (response.status === 403 && reasons.some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)));
      const uncertain = response.status >= 500 || response.ok;
      throw mailError(uncertain ? 'Gmail chưa xác nhận kết quả gửi. Kiểm tra thư Đã gửi; hệ thống không tự gửi lại.'
        : limited ? 'Gmail đang giới hạn gửi mail; hệ thống sẽ thử lại theo lịch.'
          : `Gmail từ chối gửi mail (HTTP ${response.status}). Kiểm tra Gmail API, quyền gmail.send và tài khoản gửi.`,
      { statusCode: 502, retryable: limited, uncertain, retryAfterMs: retryAfterMs(response, sentAt) });
    }
  };
}

export const sendGmailEmail = createGmailTransport();

export function sendEmail(payload, options = {}) {
  const config = options.config || getMailConfig();
  return config.provider === 'resend' ? sendResendEmail(payload, { ...options, config }) : sendGmailEmail(payload, { ...options, config });
}

export async function sendResendEmail(payload, { idempotencyKey, config = getResendConfig(), fetchImpl = fetch, now = Date.now() } = {}) {
  let response;
  let data;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify(payload)
    });
    data = await response.json().catch(() => null);
  } catch {
    throw Object.assign(new Error('Không thể xác nhận kết quả gửi mail từ Resend (mạng hoặc thời gian chờ).'), { statusCode: 502, retryable: true, uncertain: true });
  }
  if (!response.ok || !data?.id) {
    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = retryAfter === null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - now) || 0;
    const concurrent = response.status === 409 && data?.name === 'concurrent_idempotent_requests';
    throw Object.assign(new Error(`Resend: ${String(data?.message || data?.error?.message || `Không xác nhận được mail (HTTP ${response.status}).`).slice(0, 500)}`), {
      statusCode: 502, retryable: response.status === 429 || response.status >= 500 || concurrent || response.ok,
      uncertain: response.status >= 500 || concurrent || response.ok, retryAfterMs
    });
  }
  return data.id;
}
