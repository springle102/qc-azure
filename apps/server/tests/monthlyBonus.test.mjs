import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateBonus, calculateMonthlyBonus, getSalaryMonth, isSalaryMonth, resolveBonusRule, validateBonusRule } from '../bonus.mjs';
import { calculateBonus as calculateSharedBonus } from '../../shared/bonus.mjs';
import { resolveBonusRule as resolveClientBonusRule } from '../../client/src/utils/bonus.mjs';

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

test('after-milestone chapters below 100% get no bonus while chapters at or above 100% do', () => {
  const tasks = chapters(25);
  tasks[20].completionPercent = 80;
  tasks[21].completionPercent = 150;
  const result = calculateMonthlyBonus(tasks, rule);
  assert.equal(result.after.rewardedCount, 4);
  assert.equal(result.total, 220000);
});

test('missing or below-100 percentages fail the gate, numeric strings at or above 100 pass', () => {
  for (const value of [null, undefined, '', 99]) {
    const tasks = chapters(21);
    tasks[0].completionPercent = value;
    assert.equal(calculateMonthlyBonus(tasks, rule).total, 0);
  }
  const tasks = chapters(20);
  tasks[0].completionPercent = '100';
  assert.equal(calculateMonthlyBonus(tasks, rule).total, 200000);
  tasks[0].completionPercent = '140';
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

async function salaryResponse(tasks, user = { role: 'Admin' }, month = null, qcData = { qcs: [{ qcId: 2, name: 'QC', freelancerId: 99 }], accounts: [] }) {
  let handler;
  const context = {
    app: { get: (_path, _auth, callback) => { handler = callback; } }, requireAuth: () => {},
    syncGoogleSheetIfDue: async () => {}, getSalaryMonth, isSalaryMonth, calculateBonus, resolveBonusRule,
    getCollection: async (key) => ({ freelancers: [{ fIld: 7, name: 'A' }, { fIld: 8, name: 'B' }], deadlines: tasks, difficultyPricing: [], ...qcData })[key],
    hasAccountRole: (account, role) => (account.roles || [account.role]).includes(role),
    getBonusSettings: async () => ({ default: { bonusPolicy: { versions: [rule] } }, byField: {} }),
    applyConfiguredPrices: (rows) => rows,
    validationError: (message) => Object.assign(new Error(message), { statusCode: 400 })
  };
  vm.createContext(context);
  vm.runInContext([
    section('async function getMergedQCs()', "app.get('/api/qcs',"),
    section('function getTaskStatus(', 'function getTaskDueTime('),
    section('function getBonusSettingsForField(', 'function validateDeadlineCreatePayload('),
    section('function filterSalaryRowsForUser(', 'function invalidateAccountSessions('),
    section("app.get('/api/salaries',", "app.post('/api/reset-all',")
  ].join('\n'), context);
  const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await handler({ query: month == null ? {} : { month }, authUser: user }, res);
  return res;
}

test('legacy explicit-month query still scopes its data; totals include bonus once', async () => {
  const tasks = [
    ...chapters(21),
    ...chapters(10).map((task) => ({ ...task, seriesId: 2, type: 'Latin' })),
    ...chapters(20).map((task) => ({ ...task, seriesId: 3, fIld: 8 })),
    ...chapters(30).map((task) => ({ ...task, seriesId: 4, submittedAt: '2026-08-20T00:00:00Z' })),
    ...chapters(30).map((task) => ({ ...task, seriesId: 5, paymentApproved: false })),
    ...chapters(1).map((task) => ({ ...task, seriesId: 6, submittedAt: null }))
  ];
  const res = await salaryResponse(tasks, { role: 'Admin' }, '2026-09');
  assert.equal(res.code, 200);
  const first = res.payload.data.find((row) => row.fIld === 7);
  assert.equal(first.earnedAmount, '310000.00');
  assert.equal(first.bonus, '205000.00');
  assert.equal(first.totalSalary, '515000.00');
  assert.equal(first.missingDateChapters.length, 1);
  assert.equal(first.bonusByField.find((item) => item.field === 'Latin').total, 0);
  assert.equal(res.payload.data.find((row) => row.fIld === 8).bonus, '200000.00');
  assert.equal(res.payload.data.find((row) => row.isQc).totalSalary, '51000.00');
  const own = await salaryResponse(tasks, { role: 'Freelancer', freelancerId: 7 }, '2026-09');
  assert.equal(own.payload.data.length, 1);
  assert.equal(own.payload.data[0].fIld, 7);
});

test('legacy explicit-month query rejects invalid months and reports unassignable dates', async () => {
  assert.equal((await salaryResponse(chapters(1), { role: 'Admin' }, '2026-13')).code, 400);
  const res = await salaryResponse(chapters(1).map((task) => ({ ...task, submittedAt: null })), { role: 'Admin' }, '2026-09');
  assert.equal(res.payload.data[0].totalSalary, '0.00');
  assert.equal(res.payload.data[0].missingDateChapters.length, 1);
});

test('default salary totals all approved chapters with one cumulative milestone per field', async () => {
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
  assert.equal(first.earnedAmount, '430000.00');
  assert.equal(first.bonus, '315000.00');
  assert.equal(first.totalSalary, '745000.00');
  assert.equal(first.missingDateChapters.length, 0);
  assert.equal(first.bonusByField.length, 1);
  assert.equal(first.bonusByField[0].chapterCount, 43);
  assert.equal(first.bonusByField[0].after.rewardedCount, 23);
  assert.equal('salaryMonth' in first.bonusByField[0], false);
  assert.equal(res.payload.data.find((row) => row.isQc).totalSalary, '64000.00');
  const own = await salaryResponse(tasks, { role: 'Freelancer', freelancerId: 7 }, null);
  assert.equal(own.payload.data.length, 1);
  assert.equal(own.payload.data[0].totalSalary, '745000.00');
});

test('chapters on opposite sides of the month boundary unlock one cumulative bonus', async () => {
  const tasks = [
    ...chapters(10).map((task) => ({ ...task, submittedAt: '2026-08-31T16:59:59Z' })),
    ...chapters(10).map((task) => ({ ...task, seriesId: 2, submittedAt: '2026-08-31T17:00:00Z' }))
  ];
  const res = await salaryResponse(tasks, { role: 'Admin' }, null);
  assert.equal(res.payload.data[0].earnedAmount, '200000.00');
  assert.equal(res.payload.data[0].bonus, '200000.00');
  assert.equal(res.payload.data[0].bonusByField.length, 1);
});

test('all approved workflow statuses count toward bonus; QC still gets Done only', async () => {
  const tasks = chapters(21);
  tasks[0].status = 'doing';
  tasks[1].status = 'submitted';
  const res = await salaryResponse(tasks);
  assert.equal(res.payload.data[0].bonus, '205000.00');
  assert.equal(res.payload.data.find((row) => row.isQc).totalSalary, '19000.00');
});

test('unset, Doing, Checking and Fixing statuses all count when approved', async () => {
  for (const status of [null, '', 'doing', 'checking', 'fixing', 'submitted', 'done']) {
    const tasks = chapters(21).map((task) => ({ ...task, status }));
    const res = await salaryResponse(tasks);
    const freelancer = res.payload.data.find((row) => !row.isQc && row.fIld === 7);
    assert.equal(freelancer.bonus, '205000.00', `status: ${status}`);
    assert.equal(freelancer.bonusByField[0].chapterCount, 21);
    assert.equal(res.payload.data.find((row) => row.isQc).taskCount, status === 'done' ? 21 : 0);
  }
});

test('undated approved tasks count in salary and bonus without altering stored dates', async () => {
  const tasks = chapters(21).map((task, index) => ({
    ...task, submittedAt: [null, '', 'invalid', undefined][index % 4]
  }));
  const snapshot = structuredClone(tasks);
  const res = await salaryResponse(tasks);
  assert.equal(res.payload.data[0].earnedAmount, '210000.00');
  assert.equal(res.payload.data[0].bonus, '205000.00');
  assert.equal(res.payload.data[0].missingDateChapters.length, 0);
  assert.deepEqual(tasks, snapshot);
});

test('approval toggles change cumulative milestones and exclude all unchecked chapters', async () => {
  const tasks = chapters(21);
  tasks[0].paymentApproved = false;
  tasks[1].paymentApproved = 0;
  assert.equal((await salaryResponse(tasks)).payload.data[0].bonus, '0.00');
  tasks[0].paymentApproved = 1;
  assert.equal((await salaryResponse(tasks)).payload.data[0].bonus, '200000.00');
  tasks[1].paymentApproved = 'true';
  assert.equal((await salaryResponse(tasks)).payload.data[0].bonus, '205000.00');
  tasks[1].paymentApproved = 'false';
  assert.equal((await salaryResponse(tasks)).payload.data[0].bonus, '200000.00');
});

test('fields and freelancers have independent cumulative milestones', async () => {
  const tasks = [
    ...chapters(10),
    ...chapters(10).map((task) => ({ ...task, seriesId: 2, type: 'Latin' })),
    ...chapters(10).map((task) => ({ ...task, seriesId: 3, fIld: 8 }))
  ];
  const res = await salaryResponse(tasks);
  const first = res.payload.data.find((row) => !row.isQc && row.fIld === 7);
  assert.equal(first.bonus, '0.00');
  assert.equal(first.bonusByField.length, 2);
  assert.equal(res.payload.data.find((row) => !row.isQc && row.fIld === 8).bonus, '0.00');
});

test('undated milestone ordering is deterministic and shared calculation stays consistent', () => {
  const tasks = chapters(23);
  tasks[0].submittedAt = null;
  tasks[1].submittedAt = 'invalid';
  tasks[0].completionPercent = 50;
  const result = calculateBonus(tasks, rule);
  assert.equal(result.total, 210000);
  assert.deepEqual(calculateBonus([...tasks].reverse(), rule), result);
  assert.deepEqual(calculateSharedBonus(tasks, rule), result);
  assert.deepEqual(calculateMonthlyBonus(tasks, rule), result);
  assert.deepEqual(resolveClientBonusRule({ bonusPolicy: rule }), resolveBonusRule({ bonusPolicy: rule }));
});

test('salary merges a legacy QC and their account while retaining earnings under both IDs', async () => {
  const qcData = {
    qcs: [{ qcId: 2, name: 'Dương', imageQR: 'saved-qr', fields: [] }],
    accounts: [{ id: 22, role: 'Admin', roles: ['Admin', 'QC'], displayName: 'Dương', email: 'duong@example.com', fields: ['Japan', 'Latin'], freelancerId: 8 }]
  };
  const tasks = [
    ...chapters(1).map((task) => ({ ...task, completionPercent: 80, receivePrice: 8000 })),
    ...chapters(1).map((task) => ({ ...task, seriesId: 2, qcId: 22 })),
    ...chapters(1).map((task) => ({ ...task, seriesId: 3, qcId: 22, paymentApproved: false }))
  ];
  const res = await salaryResponse(tasks, { role: 'Admin' }, null, qcData);
  assert.equal(res.code, 200);
  const qcs = res.payload.data.filter((row) => row.isQc);
  assert.equal(qcs.length, 1);
  assert.equal(qcs[0].qcId, 22);
  assert.equal(qcs[0].taskCount, 2);
  assert.equal(qcs[0].earnedAmount, '2000.00');
  assert.equal(qcs[0].transferredAmount, '2000.00');
  assert.equal(qcs[0].totalSalary, '4000.00');
  assert.deepEqual(Array.from(qcs[0].fields), ['Japan', 'Latin']);
  assert.equal(qcs[0].imageQR, 'saved-qr');
  assert.equal(res.payload.data.some((row) => !row.isQc && row.fIld === 8), false);
});

test('QC identity uses linked profile or email, and keeps conflicting or ambiguous names separate', async () => {
  const account = { id: 22, role: 'QC', displayName: 'Dương', email: 'duong@example.com', freelancerId: 8 };
  const qcCount = async (qcs, accounts = [account]) => {
    const res = await salaryResponse(chapters(1), { role: 'Admin' }, null, { qcs, accounts });
    assert.equal(res.code, 200);
    return res.payload.data.filter((row) => row.isQc).length;
  };
  assert.equal(await qcCount([{ qcId: 2, name: 'Old name', email: ' DUONG@example.com ' }]), 1);
  assert.equal(await qcCount([{ qcId: 2, name: 'Old name', freelancerId: 8 }]), 1);
  assert.equal(await qcCount([{ qcId: 2, name: 'Dương', email: 'another@example.com' }]), 2);
  assert.equal(await qcCount([{ qcId: 2, name: 'Dương', freelancerId: 9 }]), 2);
  assert.equal(await qcCount([{ qcId: 2, name: 'Dương' }, { qcId: 3, name: 'Dương' }]), 3);
  assert.equal(await qcCount([{ qcId: 2, name: 'Dương' }], [account, { ...account, id: 23, freelancerId: 9 }]), 3);
  assert.equal(await qcCount([{ qcId: 22, name: 'Dương' }]), 1);
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
