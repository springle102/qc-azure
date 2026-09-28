import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const databaseUrl = process.env.DATABASE_URL || '';
let pool;

const tables = {
  tasks: process.env.SUPABASE_TABLE_TASKS || 'SeriesList',
  freelancers: process.env.SUPABASE_TABLE_FREELANCERS || 'Freelancer',
  qcs: process.env.SUPABASE_TABLE_QC || 'QC',
  accounts: process.env.SUPABASE_TABLE_ACCOUNTS || 'Accounts',
  deadlineRegistrations: process.env.SUPABASE_TABLE_DEADLINE_REGISTRATIONS || 'DeadlineRegistrations',
  deadlines: process.env.SUPABASE_TABLE_DEADLINES || 'SeriesList',
  difficultyLevels: process.env.SUPABASE_TABLE_DIFFICULTY_LEVELS || 'DifficultyLevels',
  difficultyPricing: process.env.SUPABASE_TABLE_DIFFICULTY_PRICING || 'DifficultyPricing',
  bonusSettings: process.env.SUPABASE_TABLE_BONUS_SETTINGS || 'BonusSettings',
  fields: process.env.SUPABASE_TABLE_FIELDS || 'Fields',
  generalSettings: process.env.SUPABASE_TABLE_GENERAL_SETTINGS || 'GeneralSettings',
  errors: process.env.SUPABASE_TABLE_ERRORS || 'Errors'
};

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}

export function isDatabaseConfigured() {
  return Boolean(databaseUrl || isSupabaseConfigured());
}

export function getDataSource() {
  if (databaseUrl) return 'postgresql';
  if (isSupabaseConfigured()) return 'supabase';
  return 'empty';
}

export async function selectRows(collection) {
  if (databaseUrl) {
    const table = tables[collection];
    if (!table) throw new Error(`Unknown collection: ${collection}`);
    const result = await getPool().query(`SELECT * FROM ${quoteIdentifier(table)}`);
    return result.rows;
  }

  if (!isSupabaseConfigured()) return [];

  const table = tables[collection];
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase query failed for ${table}: ${message}`);
  }

  return response.json();
}

export async function updateRow(collection, keys, updates, allowedColumns) {
  const table = tables[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);

  const safeUpdates = Object.entries(updates || {}).filter(([column]) => allowedColumns.includes(column));
  if (safeUpdates.length === 0) throw new Error('Không có trường hợp lệ để cập nhật.');

  if (databaseUrl) {
    const values = safeUpdates.map(([, value]) => value);
    const setClause = safeUpdates.map(([column], index) => `${quoteIdentifier(column)} = $${index + 1}`).join(', ');
    const keyEntries = Object.entries(keys);
    const whereClause = keyEntries.map(([column], index) => `${quoteIdentifier(column)} = $${safeUpdates.length + index + 1}`).join(' AND ');
    const keyValues = keyEntries.map(([, value]) => value);
    const result = await getPool().query(
      `UPDATE ${quoteIdentifier(table)} SET ${setClause} WHERE ${whereClause} RETURNING *`,
      [...values, ...keyValues]
    );

    if (result.rows.length === 0) throw new Error('Không tìm thấy deadline cần cập nhật.');
    return result.rows[0];
  }

  if (!isSupabaseConfigured()) throw new Error('Database chưa được cấu hình.');

  const filter = Object.entries(keys)
    .map(([column, value]) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(value))}`)
    .join('&');
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${filter}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=representation',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(Object.fromEntries(safeUpdates))
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase update failed for ${table}: ${message}`);
  }

  const rows = await response.json();
  if (!rows.length) throw new Error('Không tìm thấy deadline cần cập nhật.');
  return rows[0];
}

export async function insertRow(collection, values, allowedColumns) {
  const table = tables[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);
  const safeEntries = Object.entries(values || {}).filter(([column]) => allowedColumns.includes(column));
  if (safeEntries.length === 0) throw new Error('Không có dữ liệu hợp lệ để tạo.');

  if (databaseUrl) {
    const columns = safeEntries.map(([column]) => quoteIdentifier(column)).join(', ');
    const placeholders = safeEntries.map((entry, index) => `$${index + 1}`).join(', ');
    const result = await getPool().query(
      `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${placeholders}) RETURNING *`,
      safeEntries.map(([, value]) => value)
    );
    return result.rows[0];
  }

  if (!isSupabaseConfigured()) throw new Error('Database chưa được cấu hình.');
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=representation',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(Object.fromEntries(safeEntries))
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase insert failed for ${table}: ${message}`);
  }
  const rows = await response.json();
  return rows[0];
}

export async function updateRowById(collection, id, updates, allowedColumns) {
  return updateRow(collection, { id }, updates, allowedColumns);
}

export async function deleteRowById(collection, id) {
  const table = tables[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);

  if (databaseUrl) {
    const result = await getPool().query(`DELETE FROM ${quoteIdentifier(table)} WHERE "id" = $1 RETURNING *`, [id]);
    if (result.rows.length === 0) throw new Error('Không tìm thấy mức giá cần xóa.');
    return result.rows[0];
  }

  if (!isSupabaseConfigured()) throw new Error('Database chưa được cấu hình.');
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=representation'
    }
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase delete failed for ${table}: ${message}`);
  }
  const rows = await response.json();
  if (!rows.length) throw new Error('Không tìm thấy mức giá cần xóa.');
  return rows[0];
}

export async function deleteRowsByKeys(collection, keys) {
  const table = tables[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);

  if (databaseUrl) {
    const keyEntries = Object.entries(keys || {});
    if (keyEntries.length === 0) throw new Error('Không có khóa để xóa.');
    const whereClause = keyEntries.map(([column], index) => `${quoteIdentifier(column)} = $${index + 1}`).join(' AND ');
    const result = await getPool().query(
      `DELETE FROM ${quoteIdentifier(table)} WHERE ${whereClause} RETURNING *`,
      keyEntries.map(([, value]) => value)
    );
    return result.rows;
  }

  if (!isSupabaseConfigured()) throw new Error('Database chưa được cấu hình.');
  const filter = Object.entries(keys || {})
    .map(([column, value]) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(value))}`)
    .join('&');
  const response = await fetch(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${filter}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=representation'
    }
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase delete failed for ${table}: ${message}`);
  }
  return response.json();
}

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
  }
  return pool;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}
