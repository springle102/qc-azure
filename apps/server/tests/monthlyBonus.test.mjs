import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateMonthlyBonus, getSalaryMonth, isSalaryMonth, resolveBonusRule, validateBonusRule } from '../bonus.mjs';

const rule = { kpiEnabled: true, kpiThreshold: 20, kpiAmount: 200000,
  afterEnabled: true, afterThreshold: 20, afterAmount: 5000, qcDefaultPrice: 1000 };
const chapters = (count) => Array.from({ length: count }, (_, index) => ({
  seriesId: 1, chapterNumber: String(index + 1), fIld: 7, qcId: 2, type: 'Japan',
  submittedAt: new Date(Date.UTC(2026, 8, 1) + index * 60000).toISOString(),
  status: 'done', completionPercent: 100, price: 10000, receivePrice: 10000, paymentApproved: true
}));

test('KPI is paid once, after-milestone starts strictly at N+1', () => {
  for (const [count, expected] of [[0, 0], [19, 0], [20, 200000], [21, 205000], [25, 225000], [40, 300000]]) {
    assert.equal(calculateMonthlyBonus(chapters(count), rule).total, expected);
  }
});

test('partial chapters inside the milestone are never replaced by later full chapters', () => {
  const tasks = chapters(30);
  tasks[2].completionPercent = 90;
  const blocked = calculateMonthlyBonus(tasks, rule);
  assert.equal(blocked.total, 0);
  assert.equal(blocked.kpi.blockedChapters[0].chapterNumber, '3');
  tasks[2].completionPercent = 100;
  assert.equal(calculateMonthlyBonus(tasks, rule).total, 250000);
});

test('milestones unlock independently and switches can disable either or both', () => {
  const tasks = chapters(25);
  tasks[15].completionPercent = 90;
  assert.equal(calculateMonthlyBonus(tasks, { ...rule, kpiThreshold: 10 }).total, 200000);
  assert.equal(calculateMonthlyBonus(chapters(25), { ...rule, kpiEnabled: false }).total, 25000);
  assert.equal(calculateMonthlyBonus(chapters(25), { ...rule, afterEnabled: false }).total, 200000);
  assert.equal(calculateMonthlyBonus(chapters(25), { ...rule, kpiEnabled: false, afterEnabled: false }).total, 0);
});

test('after-milestone partial chapters get no bonus without blocking later full chapters', () => {
  const tasks = chapters(25);
  tasks[20].completionPercent = 80;
  tasks[21].completionPercent = 150;
  const result = calculateMonthlyBonus(tasks, rule);
  assert.equal(result.after.rewardedCount, 3);
  assert.equal(result.total, 215000);
});

test('missing percentages fail the 100% gate, numeric strings pass', () => {
  for (const value of [null, undefined, '', 99, 101, 200]) {
    const tasks = chapters(21);
    tasks[0].completionPercent = value;
    assert.equal(calculateMonthlyBonus(tasks, rule).total, 0);
  }
  const tasks = chapters(20);
  tasks[0].completionPercent = '100';
  assert.equal(calculateMonthlyBonus(tasks, rule).total, 200000);
});

test('order is deterministic across syncs, with series/chapter tie breakers', () => {
  const tasks = chapters(22);
  tasks[0].completionPercent = 50;
  assert.equal(calculateMonthlyBonus(tasks.reverse(), rule).total, 0);
  const tied = chapters(22).map((task) => ({ ...task, submittedAt: '2026-09-01T00:00:00Z' }));
  tied[19].completionPercent = 50;
  assert.equal(calculateMonthlyBonus(tied.reverse(), rule).total, 0);
});

test('money is accumulated in cents', () => {
  assert.equal(calculateMonthlyBonus(chapters(23), { ...rule, kpiAmount: 0.1, afterAmount: 0.2 }).total, 0.7);
});

test('monthly grouping uses Vietnam time and does not invent dates', () => {
  assert.equal(getSalaryMonth('2026-08-31T16:59:59Z'), '2026-08');
  assert.equal(getSalaryMonth('2026-08-31T17:00:00Z'), '2026-09');
  assert.equal(getSalaryMonth('2026-12-31T17:00:00Z'), '2027-01');
  for (const value of ['', null, 'not-a-date']) assert.equal(getSalaryMonth(value), null);
  for (const value of ['2026-00', '2026-13', '26-09', ['2026-09'], '0000-01']) assert.equal(isSalaryMonth(value), false);
});

test('current policy is applied directly to paid chapters, with legacy amounts as fallback', () => {
  const legacy = { taskThreshold: 30, bonusPerTask: 8000, qcDefaultPrice: 1500 };
  assert.equal(resolveBonusRule(legacy).afterThreshold, 30);
  assert.equal(resolveBonusRule(legacy).afterAmount, 8000);
  assert.equal(resolveBonusRule(legacy).qcDefaultPrice, 1500);
  const stored = { bonusPolicy: { ...rule, kpiAmount: 350000 } };
  assert.equal(resolveBonusRule(stored).kpiAmount, 350000);
});

test('configuration rejects malformed booleans, dates, thresholds and amounts', () => {
  assert.equal(validateBonusRule(rule, '2026-09').kpiAmount, 200000);
  for (const patch of [
    { afterThreshold: 0 }, { kpiThreshold: 1.5 },
    { kpiEnabled: 'false' }, { kpiAmount: -1 }, { afterAmount: '' }, { afterAmount: null },
    { afterAmount: 0.00001 }, { afterAmount: true }, { qcDefaultPrice: Infinity }
  ]) assert.throws(() => validateBonusRule({ ...rule, ...patch }, '2026-09'), { statusCode: 400 });
});

// Exercise the actual route and salary builders, replacing only I/O and price decoration.
const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Server section exists: ${start}`);
  return source.slice(from, to);
}

async function salaryResponse(tasks, user = { role: 'Admin' }, month = '2026-09') {
  let handler;
  const context = {
    app: { get: (_path, _auth, callback) => { handler = callback; } }, requireAuth: () => {},
    syncGoogleSheetIfDue: async () => {}, getSalaryMonth, isSalaryMonth, calculateMonthlyBonus, resolveBonusRule,
    getCollection: async (key) => ({ freelancers: [{ fIld: 7, name: 'A' }, { fIld: 8, name: 'B' }], deadlines: tasks, difficultyPricing: [] })[key],
    getMergedQCs: async () => [{ qcId: 2, name: 'QC', freelancerId: 99 }],
    getBonusSettings: async () => ({ default: { bonusPolicy: { versions: [rule] } }, byField: {} }),
    applyConfiguredPrices: (rows) => rows,
    validationError: (message) => Object.assign(new Error(message), { statusCode: 400 })
  };
  vm.createContext(context);
  vm.runInContext([
    section('function getTaskStatus(', 'function getTaskDueTime('),
    section('function getBonusSettingsForField(', 'function validateDeadlineCreatePayload('),
    section('function filterSalaryRowsForUser(', 'function invalidateAccountSessions('),
    section("app.get('/api/salaries',", "app.post('/api/reset-all',")
  ].join('\n'), context);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handler({ query: month == null ? {} : { month }, authUser: user }, res);
  return res;
}

test('salary route scopes by month, field and freelancer; totals include bonus once', async () => {
  const tasks = [
    ...chapters(21),
    ...chapters(10).map((task) => ({ ...task, seriesId: 2, type: 'Latin' })),
    ...chapters(20).map((task) => ({ ...task, seriesId: 3, fIld: 8 })),
    ...chapters(30).map((task) => ({ ...task, seriesId: 4, submittedAt: '2026-08-20T00:00:00Z' })),
    ...chapters(30).map((task) => ({ ...task, seriesId: 5, paymentApproved: false })),
    ...chapters(1).map((task) => ({ ...task, seriesId: 6, submittedAt: null }))
  ];
  const res = await salaryResponse(tasks);
  assert.equal(res.code, 200);
  const first = res.payload.data.find((row) => row.fIld === 7);
  assert.equal(first.earnedAmount, '310000.00');
  assert.equal(first.bonus, '205000.00');
  assert.equal(first.totalSalary, '515000.00');
  assert.equal(first.missingDateChapters.length, 1);
  assert.equal(first.bonusByField.find((item) => item.field === 'Latin').total, 0);
  assert.equal(res.payload.data.find((row) => row.fIld === 8).bonus, '200000.00');
  assert.equal(res.payload.data.find((row) => row.isQc).totalSalary, '51000.00');
  const own = await salaryResponse(tasks, { role: 'Freelancer', freelancerId: 7 });
  assert.equal(own.payload.data.length, 1);
  assert.equal(own.payload.data[0].fIld, 7);
});

test('salary API rejects invalid months and reports undated tasks without assigning salary', async () => {
  assert.equal((await salaryResponse(chapters(1), { role: 'Admin' }, '2026-13')).code, 400);
  const res = await salaryResponse(chapters(1).map((task) => ({ ...task, submittedAt: null })));
  assert.equal(res.payload.data[0].totalSalary, '0.00');
  assert.equal(res.payload.data[0].missingDateChapters.length, 1);
});

test('salary API without a month totals all periods and keeps monthly bonus milestones separate', async () => {
  const tasks = [
    ...chapters(21),
    ...chapters(21).map((task) => ({ ...task, seriesId: 2, submittedAt: '2026-08-20T00:00:00Z' })),
    ...chapters(21).map((task) => ({ ...task, seriesId: 3, fIld: 8 })),
    ...chapters(1).map((task) => ({ ...task, seriesId: 4, paymentApproved: false })),
    ...chapters(1).map((task) => ({ ...task, seriesId: 5, submittedAt: null }))
  ];
  const res = await salaryResponse(tasks, { role: 'Admin' }, null);
  assert.equal(res.code, 200);
  const first = res.payload.data.find((row) => row.fIld === 7);
  assert.equal(first.salaryMonth, null);
  assert.equal(first.earnedAmount, '420000.00');
  assert.equal(first.bonus, '410000.00');
  assert.equal(first.totalSalary, '830000.00');
  assert.equal(first.missingDateChapters.length, 1);
  assert.equal(first.bonusByField.find((summary) => summary.salaryMonth === '2026-08').total, 205000);
  assert.equal(first.bonusByField.find((summary) => summary.salaryMonth === '2026-09').total, 205000);
  assert.equal(res.payload.data.find((row) => row.isQc).totalSalary, '63000.00');
  const own = await salaryResponse(tasks, { role: 'Freelancer', freelancerId: 7 }, null);
  assert.equal(own.payload.data.length, 1);
  assert.equal(own.payload.data[0].totalSalary, '830000.00');
});

test('all-period salary does not pool chapters across the Vietnam month boundary to unlock bonus', async () => {
  const tasks = [
    ...chapters(10).map((task) => ({ ...task, submittedAt: '2026-08-31T16:59:59Z' })),
    ...chapters(10).map((task) => ({ ...task, seriesId: 2, submittedAt: '2026-08-31T17:00:00Z' }))
  ];
  const res = await salaryResponse(tasks, { role: 'Admin' }, null);
  assert.equal(res.payload.data[0].earnedAmount, '200000.00');
  assert.equal(res.payload.data[0].bonus, '0.00');
  assert.equal(res.payload.data[0].bonusByField.length, 2);
});

test('only Submitted/Done chapters count toward bonus; QC gets Done only', async () => {
  const tasks = chapters(21);
  tasks[0].status = 'doing';
  tasks[1].status = 'submitted';
  const res = await salaryResponse(tasks);
  assert.equal(res.payload.data[0].bonus, '200000.00');
  assert.equal(res.payload.data.find((row) => row.isQc).totalSalary, '19000.00');
});

test('bonus settings API persists both mechanisms across reloads', async () => {
  let handler;
  const rows = [{ id: 1, field: null, taskThreshold: 30, bonusPerTask: 8000, qcDefaultPrice: 1500 }];
  const context = {
    app: { patch: (_path, _auth, callback) => { handler = callback; } }, requireManager: () => {},
    selectRows: async () => structuredClone(rows), getCollection: async () => structuredClone(rows),
    assertConfiguredFields: async () => {}, normalizeConfiguredFieldName: (value) => value,
    validateBonusRule,
    bonusSettingsFields: ['field', 'bonusPolicy'],
    insertRow: async (_table, data) => { rows.push(structuredClone(data)); return data; },
    updateRow: async (_table, keys, data) => {
      const index = rows.findIndex((row) => row.id === keys.id);
      rows[index] = { ...rows[index], ...structuredClone(data) };
      return rows[index];
    }
  };
  vm.createContext(context);
  vm.runInContext([
    section('function validateBonusSettingsPayload(', 'function validationError('),
    section('async function getBonusSettings()', 'function getBonusSettingsForField('),
    section("app.patch('/api/bonus-settings',", "app.patch('/api/profile',")
  ].join('\n'), context);
  const save = async (body) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await handler({ body }, res);
    return res;
  };
  assert.equal((await save({ field: 'Japan', ...rule })).code, 200);
  assert.equal((await save({ field: 'Japan', ...rule, kpiAmount: 300000, afterEnabled: false })).code, 200);
  const loaded = await vm.runInContext('getBonusSettings()', context);
  assert.equal(rows.length, 2);
  assert.equal(loaded.byField.Japan.bonusPolicy.afterEnabled, false);
  assert.equal(resolveBonusRule(loaded.byField.Japan).kpiAmount, 300000);
  assert.equal(resolveBonusRule(loaded.byField.Japan).afterThreshold, 20);
  assert.equal(resolveBonusRule(loaded.byField.Japan).afterAmount, 5000);
  const previous = JSON.stringify(rows);
  assert.equal((await save({ field: 'Japan', ...rule, kpiAmount: -1 })).code, 400);
  assert.equal(JSON.stringify(rows), previous);
});
