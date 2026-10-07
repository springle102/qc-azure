import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/views/ErrorManagementView.jsx', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

function harness(role, succeeds = true) {
  const row = { id: 42, title: 'Series', note: 'Original', editorFreelancerId: 9 };
  let drafts = { [row.id]: { ...row, note: 'Đã sửa', title: 'Protected title' } };
  const requests = [];
  const context = vm.createContext({
    currentUser: { role },
    draftRows: drafts,
    setDraftRows: (update) => { drafts = update(drafts); },
    handleUpdate: async (_row, updates) => {
      requests.push(JSON.parse(JSON.stringify(updates)));
      return succeeds ? { ...row, ...updates } : null;
    }
  });
  vm.runInContext([
    slice('  const canManage =', '  const [activeField'),
    slice('  const hasRowDraftChanges =', '  const handleStartInlineRow'),
    slice('  const handleSaveRowDraft =', '  const handleSaveSheetUrls'),
    'globalThis.save = handleSaveRowDraft; globalThis.isDirty = hasRowDraftChanges; globalThis.canEdit = canEditNotes;'
  ].join('\n'), context);
  return { row, context, requests, get drafts() { return drafts; } };
}

test('Freelancer saves only Note and clears the draft on success', async () => {
  const state = harness('Freelancer');
  assert.equal(state.context.canEdit, true);
  assert.equal(state.context.isDirty(state.row, { ...state.row, title: 'Changed' }), false);
  assert.equal(state.context.isDirty(state.row, { ...state.row, note: '' }), true);
  await state.context.save(state.row);
  assert.deepEqual(state.requests, [{ note: 'Đã sửa' }]);
  assert.equal(Object.keys(state.drafts).length, 0);
});

test('failed Note save retains the draft for retry', async () => {
  const state = harness('Freelancer', false);
  await state.context.save(state.row);
  assert.equal(state.drafts[42].note, 'Đã sửa');
});

test('Admin and QC retain their existing error editing permissions', async () => {
  for (const role of ['Admin', 'QC']) {
    const state = harness(role);
    await state.context.save(state.row);
    assert.deepEqual(state.requests, [{ title: 'Protected title', note: 'Đã sửa' }]);
  }
});
