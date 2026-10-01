import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../client/src/components/views/DeadlineRegistrationView.jsx', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
function extract(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
}

function harness() {
  const routes = {};
  const registrations = [{ id: 1, fIld: 10 }, { id: 2, fId: 20 }];
  const freelancers = [
    { fIld: 10, name: 'Alice', fields: ['Japan'], email: 'private@example.com' },
    { fIld: 20, name: 'Bob', field: 'Latin' }
  ];
  const writes = [];
  const context = vm.createContext({
    app: Object.fromEntries(['get', 'post', 'patch', 'delete'].map((method) => [method, (path, _auth, handler) => {
      routes[`${method} ${path}`] = handler;
    }])),
    requireAuth: () => {},
    isValidConfiguredFieldName: (field) => ['Japan', 'Latin'].includes(field),
    getCollection: async (name) => name === 'freelancers' ? freelancers : registrations,
    validateDeadlineRegistrationPayload: (payload) => ({ fIld: payload.fIld, chaptersPerWeek: 3 }),
    insertRow: async (_table, payload) => { writes.push(payload); return { id: 3, ...payload }; },
    updateRowById: async (_table, id, payload) => { writes.push(payload); return { id, ...payload }; }
  });
  vm.runInContext([
    ...['getFreelancerId', 'normalizeStoredFields', 'filterFreelancerRowsForUser',
      'filterDeadlineRegistrationRowsForUser', 'toPublicDeadlineRegistration'].map((name) => extract(server, name)),
    ...['getFreelancerFields', 'getFieldOptions', 'getRegistrationFields'].map((name) => extract(client, name)),
    server.slice(server.indexOf("app.get('/api/deadline-registrations'"), server.indexOf("app.patch('/api/freelancers/:id'"))
  ].join('\n'), context);
  async function request(route, user, body = {}, id = '1') {
    let result;
    const response = { status: () => response, json: (payload) => { result = plain(payload); } };
    await routes[route]({ authUser: user, body, params: { id } }, response);
    assert.equal(result.success, true, result.message);
    return result.data;
  }
  return { context, request, freelancers, writes };
}

test('QC sees freelancer fields outside its own scope in deadline registrations and field filters', async () => {
  const { context, request, freelancers } = harness();
  const qc = { role: 'QC', fields: ['Japan'] };
  const scopedFreelancers = context.filterFreelancerRowsForUser(freelancers, qc);
  assert.deepEqual(plain(scopedFreelancers).map((row) => row.fIld), [10]);

  const rows = await request('get /api/deadline-registrations', qc);
  assert.deepEqual(rows.map((row) => row.fields), [['Japan'], ['Latin']]);
  assert.equal(rows[1].fIld, 20);
  assert.equal(rows[1].name, 'Bob');
  assert.equal(rows[0].email, undefined);
  const byId = new Map(scopedFreelancers.map((row) => [String(row.fIld), row]));
  assert.deepEqual(plain(context.getRegistrationFields(rows[1], byId)), ['Latin']);
  assert.deepEqual(plain(context.getFieldOptions([...scopedFreelancers, ...rows])), ['Japan', 'Latin']);
});

test('freelancers still see only their own registration', async () => {
  const { request } = harness();
  const rows = await request('get /api/deadline-registrations', { role: 'Freelancer', freelancerId: 20 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].fields, ['Latin']);
});

test('create and update responses retain fields without storing them in registration rows', async () => {
  const { request, writes } = harness();
  const qc = { role: 'QC', fields: ['Japan'] };
  const created = await request('post /api/deadline-registrations', qc, { fIld: 20 });
  const updated = await request('patch /api/deadline-registrations/:id', qc, { fIld: 20 });
  for (const row of [created, updated]) {
    assert.equal(row.field, 'Latin');
    assert.deepEqual(row.fields, ['Latin']);
  }
  assert.ok(writes.every((row) => !('fields' in row) && !('field' in row)));
});

test('older responses fall back to freelancer data and missing freelancers display an empty field', () => {
  const { context } = harness();
  const byId = new Map([['10', { field: 'Japan' }]]);
  assert.deepEqual(plain(context.getRegistrationFields({ fIld: 10 }, byId)), ['Japan']);
  const missing = context.toPublicDeadlineRegistration({ fIld: 99, name: 'Old name' });
  assert.equal(missing.name, 'Old name');
  assert.deepEqual(plain(context.getRegistrationFields(missing, byId)), []);
});
