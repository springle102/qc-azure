import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const extract = (name) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
};
const fields = [{ id: 1, name: 'Japan' }, { id: 2, name: 'Latin' }];
const errors = [{ id: 1, field: 'Japan', editorFreelancerId: 9 }, { id: 2, field: 'Latin', editorFreelancerId: 10 }];

function harness(accountFields = [], linkedFields = ['Japan']) {
  const account = { id: 1, username: 'duong', role: 'Admin', roles: ['Admin', 'QC'], fields: accountFields, freelancerId: 9 };
  const freelancers = [{ fIld: 9, name: 'Duong', fields: linkedFields }];
  let login;
  const context = vm.createContext({
    ACCOUNT_ROLES: ['Admin', 'QC', 'Freelancer'],
    ROLE_PRIORITY: { Freelancer: 1, QC: 2, Admin: 3 },
    SESSION_TTL_MS: 100000,
    sessions: new Map(),
    crypto: { randomBytes: () => ({ toString: () => 'test-token' }) },
    verifyPassword: () => true,
    getCollection: async (name) => name === 'accounts' ? [account] : freelancers,
    getConfiguredFields: async () => fields,
    app: { post: (_path, handler) => { login = handler; } }
  });
  vm.runInContext([
    ...['isValidConfiguredFieldName', 'normalizeStoredFields', 'normalizeAccountRoles', 'getAccountRoles',
      'getEffectiveRole', 'hasAnyRole', 'hasAccountRole', 'toPublicAccount', 'getBearerToken', 'getAuthUser',
      'getVisibleFields', 'filterErrorRowsForUser', 'canManagerManageField'].map(extract),
    source.slice(source.indexOf("app.post('/api/auth/login'"), source.indexOf("app.post('/api/auth/forgot-password/request-otp'"))
  ].join('\n'), context);
  return { context, account, freelancers, login };
}

test('login retains linked profile fields when an Admin/QC account has an empty fields array', async () => {
  const { context, login } = harness();
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await login({ body: { username: 'duong', password: 'test' } }, res);
  assert.equal(res.body.success, true);
  assert.deepEqual(plain(res.body.data.user.fields), ['Japan']);
  const qc = context.getAuthUser({ headers: { authorization: 'Bearer test-token', 'x-active-role': 'QC' } });
  assert.equal(qc.role, 'QC');
  assert.deepEqual(plain(await context.getVisibleFields(qc)), [fields[0]]);
  assert.deepEqual(plain(context.filterErrorRowsForUser(errors, qc)), [errors[0]]);
  assert.equal(context.canManagerManageField(qc, 'Japan'), true);
  assert.equal(context.canManagerManageField(qc, 'Latin'), false);
});

test('explicit account fields take priority over linked profile fields', () => {
  const { context, account, freelancers } = harness(['Latin']);
  const user = context.toPublicAccount(account, freelancers);
  assert.deepEqual(plain(user.fields), ['Latin']);
  assert.equal(user.field, 'Latin');
});

test('legacy single account field takes priority over linked profile fields', () => {
  const { context, account, freelancers } = harness();
  const user = context.toPublicAccount({ ...account, field: 'Latin' }, freelancers);
  assert.deepEqual(plain(user.fields), ['Latin']);
});

test('QC without any assigned fields remains restricted even when the account also has Admin', async () => {
  const { context, account, freelancers } = harness([], []);
  const qc = { ...context.toPublicAccount(account, freelancers), role: 'QC' };
  assert.deepEqual(plain(await context.getVisibleFields(qc)), []);
  assert.deepEqual(plain(context.filterErrorRowsForUser(errors, qc)), []);
  assert.equal(context.canManagerManageField(qc, 'Japan'), false);
});

test('Freelancer remains limited to assigned errors and Admin sees configured fields', async () => {
  const { context, account, freelancers } = harness();
  const user = context.toPublicAccount(account, freelancers);
  assert.deepEqual(plain(await context.getVisibleFields(user)), fields);
  assert.deepEqual(plain(context.filterErrorRowsForUser(errors, { ...user, role: 'Freelancer' })), [errors[0]]);
});
