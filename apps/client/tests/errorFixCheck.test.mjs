import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/views/ErrorManagementView.jsx', import.meta.url), 'utf8');
const from = source.indexOf('  const handleCheck = async');
const to = source.indexOf('  const handleDelete = async', from);
assert.ok(from >= 0 && to > from);

function harness() {
  const requests = [];
  const updates = [];
  const toasts = [];
  let overrides = {};
  let warning = 'Previous warning';
  const pendingFixChecks = { current: new Set() };
  const errorMutationVersion = { current: 0 };
  const context = vm.createContext({
    pendingFixChecks,
    errorMutationVersion,
    setFixCheckOverrides: (update) => { overrides = update(overrides); },
    setFixCheckSyncWarning: (value) => { warning = value; },
    updateLocalRow: (row) => updates.push(row),
    showToast: (message, type) => toasts.push({ message, type }),
    api: { updateError: (id, values) => new Promise((resolve, reject) => requests.push({ id, values, resolve, reject })) }
  });
  vm.runInContext(`${source.slice(from, to)}\nglobalThis.handleCheck = handleCheck;`, context);
  return {
    check: context.handleCheck,
    requests, updates, toasts, pendingFixChecks, errorMutationVersion,
    get overrides() { return overrides; },
    get warning() { return warning; }
  };
}

test('tick and untick display immediately while a delayed save is pending', async () => {
  for (const checked of [true, false]) {
    const state = harness();
    const row = { id: 42, fixCheck: !checked };
    const saving = state.check(row, checked);
    assert.equal(state.overrides['42'], checked);
    assert.equal(state.pendingFixChecks.current.has('42'), true);
    assert.equal(state.updates.length, 0);
    assert.equal(row.fixCheck, !checked);
    assert.equal(state.requests[0].values.fixCheck, checked);
    state.requests[0].resolve({ ...row, fixCheck: checked });
    await saving;
    assert.equal(state.updates[0].fixCheck, checked);
    assert.equal(Object.keys(state.overrides).length, 0);
    assert.equal(state.pendingFixChecks.current.size, 0);
    assert.equal(state.warning, '');
    assert.equal(state.errorMutationVersion.current, 2);
  }
});

test('failed save removes the optimistic value without committing it', async () => {
  const state = harness();
  const row = { id: 42, fixCheck: false };
  const saving = state.check(row, true);
  assert.equal(state.overrides['42'], true);
  state.requests[0].reject(new Error('Sheet unavailable'));
  await saving;
  assert.equal(Object.keys(state.overrides).length, 0);
  assert.equal(state.updates.length, 0);
  assert.equal(row.fixCheck, false);
  assert.deepEqual(state.toasts, [{ message: 'Sheet unavailable', type: 'error' }]);
  assert.equal(state.pendingFixChecks.current.size, 0);
  assert.equal(state.errorMutationVersion.current, 2);
});

test('different rows save independently; duplicate clicks on a pending row are ignored', async () => {
  const state = harness();
  const first = state.check({ id: 42, fixCheck: false }, true);
  await state.check({ id: '42', fixCheck: false }, false);
  const second = state.check({ id: 43, fixCheck: true }, false);
  assert.equal(state.requests.length, 2);
  assert.equal(state.overrides['42'], true);
  assert.equal(state.overrides['43'], false);
  state.requests[1].resolve({ id: 43, fixCheck: false });
  await second;
  assert.equal(state.overrides['42'], true);
  assert.equal(Object.hasOwn(state.overrides, '43'), false);
  assert.equal(state.pendingFixChecks.current.has('42'), true);
  state.requests[0].reject(new Error('Save failed'));
  await first;
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].id, 43);
  assert.equal(state.pendingFixChecks.current.size, 0);
  assert.equal(Object.keys(state.overrides).length, 0);
});
