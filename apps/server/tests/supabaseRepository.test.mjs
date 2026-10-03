import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabasePoolOptions } from '../supabaseRepository.js';

test('Supabase PostgreSQL URLs require verified TLS while local PostgreSQL stays unchanged', () => {
  assert.deepEqual(createDatabasePoolOptions('postgresql://postgres:secret@db.example.supabase.co:5432/postgres'), {
    connectionString: 'postgresql://postgres:secret@db.example.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: true }
  });
  assert.deepEqual(createDatabasePoolOptions('postgresql://postgres:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres'), {
    connectionString: 'postgresql://postgres:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: true }
  });
  assert.deepEqual(createDatabasePoolOptions('postgresql://postgres:password@localhost:5432/Qc-WZ'), {
    connectionString: 'postgresql://postgres:password@localhost:5432/Qc-WZ'
  });
});
