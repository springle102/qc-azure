import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/views/DeadlineManagementView.jsx', import.meta.url), 'utf8');
const from = source.indexOf('function getStatusDisplayValue(');
const to = source.indexOf('function getVisibleStatusOptions(', from);
assert.ok(from >= 0 && to > from);
assert.match(source, /const overdue = isDeadlineRowOverdue\(item, statusOverrides\)/);
assert.match(source, /className=\{overdue \? 'deadline-row-overdue' : undefined\}/);

function harness(now = '2026-10-03T00:00:00+07:00') {
  class Clock extends Date {
    static now() { return Date.parse(now); }
  }
  const context = vm.createContext({ Date: Clock });
  vm.runInContext(source.slice(from, to), context);
  return context;
}

const overdueRow = { seriesId: 42, chapterNumber: '1A', endTask: '2026-10-02' };

test('overdue Doing and unset statuses highlight the whole row', () => {
  const { isDeadlineRowOverdue } = harness();
  for (const status of ['doing', 'Doing', ' DOING ', '', '  ', null, undefined]) {
    assert.equal(isDeadlineRowOverdue({ ...overdueRow, status }), true, `status: ${status}`);
  }
  assert.equal(isDeadlineRowOverdue(overdueRow), true);
});

test('submitted and subsequent statuses do not highlight the whole row', () => {
  const { isDeadlineRowOverdue } = harness();
  for (const status of ['submitted', 'checking', 'fixing', 'done', 'Done']) {
    assert.equal(isDeadlineRowOverdue({ ...overdueRow, status }), false);
  }
});

test('not-yet-due, missing and invalid deadlines never highlight', () => {
  const { isDeadlineRowOverdue } = harness();
  for (const endTask of ['2026-10-03', '2026-10-04', '', null, undefined, 'not-a-date']) {
    for (const status of ['', 'doing']) {
      assert.equal(isDeadlineRowOverdue({ ...overdueRow, endTask, status }), false);
    }
  }
});

test('deadline cutoff stays at the end of the Vietnam calendar day', () => {
  const row = { ...overdueRow, status: 'doing' };
  assert.equal(harness('2026-10-02T23:59:59.999+07:00').isDeadlineRowOverdue(row), false);
  assert.equal(harness('2026-10-03T00:00:00+07:00').isDeadlineRowOverdue(row), true);
});

test('optimistic status changes and clearing status control highlighting', () => {
  const { isDeadlineRowOverdue } = harness();
  const row = { ...overdueRow, status: 'doing' };
  assert.equal(isDeadlineRowOverdue(row, { '42-1A': 'submitted' }), false);
  assert.equal(isDeadlineRowOverdue({ ...row, status: 'done' }, { '42-1A': 'doing' }), true);
  assert.equal(isDeadlineRowOverdue({ ...row, status: 'done' }, { '42-1A': null }), true);
  assert.equal(isDeadlineRowOverdue({ ...row, status: 'done' }, { '42-1A': '' }), true);
  assert.equal(isDeadlineRowOverdue(row, { '43-1A': 'submitted' }), true);
  assert.equal(isDeadlineRowOverdue(row, {}), true);
});

test('late-submission warning remains independent of the new unset-status rule', () => {
  const { isSubmissionLate } = harness();
  assert.equal(isSubmissionLate({ ...overdueRow, submittedAt: '2026-10-03T00:00:00+07:00' }), true);
  assert.equal(isSubmissionLate({ ...overdueRow, submittedAt: '2026-10-02T23:59:59+07:00' }), false);
  assert.equal(isSubmissionLate(overdueRow), false);
});
