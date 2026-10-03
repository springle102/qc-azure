import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
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

test('bundled Supabase root is a valid public CA wired into both backend Dockerfiles', () => {
  const certificate = new X509Certificate(readFileSync(new URL('../certs/supabase-ca.crt', import.meta.url)));
  assert.equal(certificate.ca, true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.match(certificate.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(certificate.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.ok(Date.now() >= Date.parse(certificate.validFrom));
  assert.ok(Date.now() < Date.parse(certificate.validTo));
  for (const file of ['Dockerfile', 'Dockerfile.railway']) {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    assert.match(source, /ENV NODE_EXTRA_CA_CERTS=\/app\/apps\/server\/certs\/supabase-ca\.crt/);
  }
});
