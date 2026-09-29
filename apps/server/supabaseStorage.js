import 'dotenv/config';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const bucketName = process.env.SUPABASE_ERROR_SCREENSHOT_BUCKET || 'error-screenshots';
const avatarBucketName = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';
const qrBucketName = process.env.SUPABASE_QR_BUCKET || 'qr-codes';
const bucketPromises = new Map();

function storageHeaders(extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra
  };
}

function encodeStoragePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function isErrorScreenshotStorageConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export function getErrorScreenshotBucket() {
  return bucketName;
}

export function getErrorScreenshotPublicUrl(path) {
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucketName)}/${encodeStoragePath(path)}`;
}

export function getErrorScreenshotStoragePath(value) {
  const text = String(value || '').trim();
  if (!text || !isErrorScreenshotStorageConfigured()) return null;

  try {
    const parsed = new URL(text);
    const expectedPrefix = `/storage/v1/object/public/${bucketName}/`;
    if (parsed.origin !== new URL(supabaseUrl).origin || !parsed.pathname.startsWith(expectedPrefix)) return null;
    return decodeURIComponent(parsed.pathname.slice(expectedPrefix.length));
  } catch {
    return null;
  }
}

export function isAvatarStorageConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export function getAvatarPublicUrl(path) {
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(avatarBucketName)}/${encodeStoragePath(path)}`;
}

export function getAvatarStoragePath(value) {
  const text = String(value || '').trim();
  if (!text || !isAvatarStorageConfigured()) return null;

  try {
    const parsed = new URL(text);
    const expectedPrefix = `/storage/v1/object/public/${avatarBucketName}/`;
    if (parsed.origin !== new URL(supabaseUrl).origin || !parsed.pathname.startsWith(expectedPrefix)) return null;
    return decodeURIComponent(parsed.pathname.slice(expectedPrefix.length));
  } catch {
    return null;
  }
}

export function isQrStorageConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export function getQrPublicUrl(path) {
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(qrBucketName)}/${encodeStoragePath(path)}`;
}

export function getQrStoragePath(value) {
  const text = String(value || '').trim();
  if (!text || !isQrStorageConfigured()) return null;

  try {
    const parsed = new URL(text);
    const expectedPrefix = `/storage/v1/object/public/${qrBucketName}/`;
    if (parsed.origin !== new URL(supabaseUrl).origin || !parsed.pathname.startsWith(expectedPrefix)) return null;
    return decodeURIComponent(parsed.pathname.slice(expectedPrefix.length));
  } catch {
    return null;
  }
}

async function ensureBucket(targetBucketName = bucketName) {
  if (!isErrorScreenshotStorageConfigured()) throw new Error('Supabase Storage chưa được cấu hình.');
  const currentPromise = bucketPromises.get(targetBucketName);
  if (!currentPromise) {
    const nextPromise = (async () => {
      const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(targetBucketName)}`;
      const detailsResponse = await fetch(bucketUrl, { headers: storageHeaders() });
      if (detailsResponse.ok) {
        const details = await detailsResponse.json().catch(() => ({}));
        if (details.public !== true) {
          const updateResponse = await fetch(bucketUrl, {
            method: 'PUT',
            headers: storageHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ public: true })
          });
          if (!updateResponse.ok) {
            const message = await updateResponse.text();
            throw new Error(`Không thể bật public cho bucket ${targetBucketName}: ${message}`);
          }
        }
        return;
      }

      const createResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: storageHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: targetBucketName,
          name: targetBucketName,
          public: true,
          file_size_limit: '5MB',
          allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
        })
      });
      if (!createResponse.ok && createResponse.status !== 409) {
        const message = await createResponse.text();
        throw new Error(`Không thể tạo bucket ${targetBucketName}: ${message}`);
      }
    })().catch((error) => {
      bucketPromises.delete(targetBucketName);
      throw error;
    });
    bucketPromises.set(targetBucketName, nextPromise);
  }
  return bucketPromises.get(targetBucketName);
}

export async function uploadAvatar({ path, data, contentType }) {
  await ensureBucket(avatarBucketName);
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(avatarBucketName)}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: storageHeaders({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true'
    }),
    body: data
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Không thể tải ảnh đại diện lên Supabase Storage: ${message}`);
  }
  return getAvatarPublicUrl(path);
}

export async function removeAvatars(paths) {
  const normalizedPaths = [...new Set((paths || []).filter(Boolean))];
  if (normalizedPaths.length === 0 || !isAvatarStorageConfigured()) return;
  await ensureBucket(avatarBucketName);
  for (let index = 0; index < normalizedPaths.length; index += 1000) {
    const batch = normalizedPaths.slice(index, index + 1000);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(avatarBucketName)}`, {
      method: 'DELETE',
      headers: storageHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: batch })
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Không thể xóa ảnh đại diện khỏi Supabase Storage: ${message}`);
    }
  }
}

export async function uploadQrCode({ path, data, contentType }) {
  await ensureBucket(qrBucketName);
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(qrBucketName)}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: storageHeaders({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true'
    }),
    body: data
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Không thể tải mã QR lên Supabase Storage: ${message}`);
  }
  return getQrPublicUrl(path);
}

export async function removeQrCodes(paths) {
  const normalizedPaths = [...new Set((paths || []).filter(Boolean))];
  if (normalizedPaths.length === 0 || !isQrStorageConfigured()) return;
  await ensureBucket(qrBucketName);
  for (let index = 0; index < normalizedPaths.length; index += 1000) {
    const batch = normalizedPaths.slice(index, index + 1000);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(qrBucketName)}`, {
      method: 'DELETE',
      headers: storageHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: batch })
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Không thể xóa mã QR khỏi Supabase Storage: ${message}`);
    }
  }
}

export async function uploadErrorScreenshot({ path, data, contentType }) {
  await ensureBucket();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeStoragePath(path)}`, {
    method: 'POST',
    headers: storageHeaders({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true'
    }),
    body: data
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Không thể tải screenshot lên Supabase Storage: ${message}`);
  }
  return getErrorScreenshotPublicUrl(path);
}

export async function removeErrorScreenshots(paths) {
  const normalizedPaths = [...new Set((paths || []).filter(Boolean))];
  if (normalizedPaths.length === 0 || !isErrorScreenshotStorageConfigured()) return;
  await ensureBucket();
  for (let index = 0; index < normalizedPaths.length; index += 1000) {
    const batch = normalizedPaths.slice(index, index + 1000);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}`, {
      method: 'DELETE',
      headers: storageHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: batch })
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Không thể xóa screenshot khỏi Supabase Storage: ${message}`);
    }
  }
}
