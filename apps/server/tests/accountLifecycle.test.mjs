import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const extract = (name) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
};

function harness(overrides = {}) {
  const rows = { freelancers: [], accounts: [], deadlines: [], deadlineRegistrations: [], errors: [], qcs: [], ...overrides };
  const routes = {};
  const writes = [];
  const invalidated = [];
  const context = vm.createContext({
    ACCOUNT_ROLES: ['Admin', 'QC', 'Freelancer'], ROLE_PRIORITY: { Freelancer: 1, QC: 2, Admin: 3 },
    app: { post: (path, _auth, fn) => { routes[path] = fn; }, delete: (path, _auth, fn) => { routes[path] = fn; } },
    requireAdmin: () => {},
    getCollection: async (name) => rows[name] || [],
    validateAccountPayload: (body) => body,
    assertConfiguredFields: async () => {}, hashPassword: () => ({ hash: 'test', salt: 'test' }),
    validationError: (message) => Object.assign(new Error(message), { statusCode: 400 }),
    toPublicAccount: (account) => account,
    invalidateAccountSessions: (id) => invalidated.push(id),
    runWithConcurrency: async (values, callback) => Promise.all(values.map(callback)),
    insertRow: async (table, values) => {
      const row = { id: 100 + rows[table].length, ...values };
      rows[table].push(row); writes.push({ type: 'insert', table, row }); return row;
    },
    updateRow: async (_table, _keys, updates) => updates,
    deleteRowById: async (table, id) => {
      const row = rows[table].find((r) => Number(r.id) === id);
      rows[table] = rows[table].filter((r) => Number(r.id) !== id);
      writes.push({ type: 'delete', table }); return row;
    },
    deleteRowsByKeys: async (table, keys) => {
      if (rows.foreignKeyRace && table === 'freelancers') throw Object.assign(new Error('referenced'), { code: '23503' });
      rows[table] = rows[table].filter((r) => !Object.entries(keys).every(([key, value]) => String(r[key]) === String(value)));
      writes.push({ type: 'delete', table }); return [];
    }
  });
  vm.runInContext([
    ...['normalizeAccountRoles', 'getAccountRoles', 'getEffectiveRole', 'hasAnyRole', 'hasAccountRole',
      'getFreelancerId', 'ensureFreelancerForAccount', 'assertFreelancerExists', 'assertFreelancerAccountAvailable',
      'syncFreelancerFromAccount', 'hasFreelancerHistory'].map(extract),
    source.slice(source.indexOf("app.post('/api/accounts'"), source.indexOf("app.patch('/api/accounts/:id'")),
    source.slice(source.indexOf("app.delete('/api/accounts/:id'"), source.indexOf("app.get('/api/deadlines'"))
  ].join('\n'), context);
  const request = async (path, body = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await routes[path]({ params: { id: '25' }, authUser: { id: 1 }, body }, res);
    return res;
  };
  return { context, rows, writes, invalidated, request };
}

const profile = { fIld: 15, name: 'Fixture Person', email: 'person@example.test', field: 'Latin', imageQR: 'existing-qr' };
const account = { id: 25, username: 'fixture', displayName: profile.name, email: profile.email, role: 'Freelancer', roles: ['Freelancer'], freelancerId: 15 };
const newAccount = { ...account, id: undefined, username: 'new-fixture', password: 'test-only', freelancerId: null, fields: ['Latin'] };

test('recreated account reuses orphan profile by normalized email and keeps QR/history', async () => {
  const h = harness({ freelancers: [{ ...profile }], deadlines: [{ fIld: 15, price: 900000 }] });
  const res = await h.request('/api/accounts', { ...newAccount, email: ' PERSON@example.test ' });
  assert.equal(res.code, 201);
  assert.equal(res.body.data.freelancerId, 15);
  assert.equal(h.rows.freelancers.length, 1);
  assert.equal(h.rows.freelancers[0].imageQR, 'existing-qr');
  assert.equal(h.rows.deadlines[0].fIld, 15);
});

test('same display name with different or missing email does not attach another person', async () => {
  for (const email of ['other@example.test', '']) {
    const h = harness({ freelancers: [{ ...profile }] });
    assert.equal(await h.context.ensureFreelancerForAccount({ ...newAccount, email }), 16);
    assert.equal(h.rows.freelancers.length, 2);
  }
});

test('ambiguous orphan profiles require repair and produce no new profile', async () => {
  const h = harness({ freelancers: [{ ...profile }, { ...profile, fIld: 20 }] });
  await assert.rejects(() => h.context.ensureFreelancerForAccount(newAccount), /nhiều hồ sơ/);
  assert.equal(h.writes.length, 0);
});

test('email already linked to an account cannot create another identity even with an orphan duplicate', async () => {
  const h = harness({ freelancers: [{ ...profile }, { ...profile, fIld: 20 }], accounts: [{ ...account }] });
  await assert.rejects(() => h.context.ensureFreelancerForAccount(newAccount), /account khác/);
  assert.equal(h.writes.length, 0);
});

test('duplicate username is rejected before creating an orphan profile', async () => {
  const h = harness({ accounts: [{ ...account }] });
  const res = await h.request('/api/accounts', { ...newAccount, username: 'FIXTURE' });
  assert.equal(res.code, 409);
  assert.equal(h.writes.length, 0);
});

for (const [table, history] of [
  ['deadlines', { fIld: 15, price: 900000 }],
  ['deadlineRegistrations', { fIld: 15 }],
  ['errors', { editorFreelancerId: 15 }]
]) {
  test(`deleting account preserves profile referenced by ${table} and revokes sessions`, async () => {
    const h = harness({ freelancers: [{ ...profile }], accounts: [{ ...account }], [table]: [history] });
    const res = await h.request('/api/accounts/:id');
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.freelancerProfileRetained, true);
    assert.equal(h.rows.accounts.length, 0);
    assert.equal(h.rows.freelancers.length, 1);
    assert.equal(h.rows[table].length, 1);
    assert.deepEqual(h.invalidated, [25]);
    assert.equal(await h.context.ensureFreelancerForAccount(newAccount), 15);
  });
}

test('deleting account removes an unused profile', async () => {
  const h = harness({ freelancers: [{ ...profile }], accounts: [{ ...account }] });
  const res = await h.request('/api/accounts/:id');
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.freelancerProfileRetained, false);
  assert.equal(h.rows.freelancers.length, 0);
});

test('another linked account or a concurrent task assignment preserves the profile', async () => {
  for (const overrides of [{ accounts: [{ ...account }, { ...account, id: 30 }] }, { foreignKeyRace: true }]) {
    const h = harness({ freelancers: [{ ...profile }], accounts: [{ ...account }], ...overrides });
    const res = await h.request('/api/accounts/:id');
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.freelancerProfileRetained, true);
    assert.equal(h.rows.freelancers.length, 1);
    assert.deepEqual(h.invalidated, [25]);
  }
});

test('QC task history also survives deleting its account', async () => {
  const h = harness({ freelancers: [{ ...profile }], accounts: [{ ...account, role: 'QC', roles: ['QC'] }],
    qcs: [{ qcId: 25, name: profile.name }], deadlines: [{ qcId: 25 }] });
  const res = await h.request('/api/accounts/:id');
  assert.equal(res.body.success, true);
  assert.equal(h.rows.qcs.length, 1);
  assert.equal(h.rows.deadlines[0].qcId, 25);
});
