import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../client/src/components/views/DeadlineManagementView.jsx', import.meta.url), 'utf8');
const options = ['≤0h', '1~3h', '3~6h', '6~10h', '>10h'];
function extract(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
}
function contextFor(source, extra = {}) {
  const context = vm.createContext({
    LATE_OPTIONS: options,
    validationError: (message) => Object.assign(new Error(message), { statusCode: 400 }),
    ...extra
  });
  vm.runInContext(['normalizeLateValue', 'calculateReceivePrice'].map((name) => extract(source, name)).join('\n'), context);
  return context;
}

test('client and server apply all five late rates on top of completion percentage', () => {
  for (const source of [server, client]) {
    const { calculateReceivePrice } = contextFor(source);
    for (const [index, expected] of [100000, 90000, 70000, 50000, 0].entries()) {
      assert.equal(calculateReceivePrice(100000, 100, options[index]), expected.toFixed(2));
      assert.equal(calculateReceivePrice(100000, 80, options[index]), (expected * 0.8).toFixed(2));
    }
    assert.equal(calculateReceivePrice('12345.67', 150, '3-6h'), '12962.95');
    assert.equal(calculateReceivePrice(100000, 100), '100000.00');
    assert.equal(calculateReceivePrice(100000, 100, ' 1 ~ 3H '), '90000.00');
  }
  assert.equal(contextFor(server).calculateReceivePrice(null, 100, '>10h'), null);
  assert.equal(contextFor(client).calculateReceivePrice('', 100, '>10h'), '');
});

test('editing late, completion, difficulty or field immediately updates the preview', () => {
  let editing = { type: 'Japan', difficulty: 'Easy', price: 100000, completionPercent: 100, late: '≤0h' };
  const context = contextFor(client, {
    setEditingDeadline: (callback) => { editing = callback(editing); },
    difficultyLevels: [],
    difficultyPrices: [
      { field: 'Japan', difficulty: 'Easy', price: 100000 },
      { field: 'Japan', difficulty: 'Hard', price: 200000 },
      { field: 'Latin', difficulty: 'Hard', price: 300000 }
    ]
  });
  vm.runInContext(['getConfiguredPrice', 'getDifficultyOptions', 'createEditState'].map((name) => extract(client, name)).join('\n'), context);
  const from = client.indexOf('  const updateEditField =');
  const to = client.indexOf('  const saveEdit =', from);
  vm.runInContext(`${client.slice(from, to)}\nglobalThis.updateEditField = updateEditField;`, context);
  context.updateEditField('late', '3~6h');
  assert.equal(editing.receivePrice, '70000.00');
  context.updateEditField('completionPercent', 80);
  assert.equal(editing.receivePrice, '56000.00');
  context.updateEditField('difficulty', 'Hard');
  assert.equal(editing.receivePrice, '112000.00');
  context.updateEditField('type', 'Latin');
  assert.equal(editing.receivePrice, '168000.00');
  context.updateEditField('late', '>10h');
  assert.equal(editing.receivePrice, '0.00');
  context.toDateInput = () => '';
  assert.equal(context.createEditState({ ...editing, late: '6~10h', receivePrice: 999999 }, []).receivePrice, '120000.00');
});

test('changing only late persists the recalculated money and rejects unsupported options', async () => {
  let handler;
  let current = { seriesId: 1, chapterNumber: '1', type: 'Japan', difficulty: 'Easy', price: 100000, completionPercent: 80, late: '≤0h' };
  const context = contextFor(server, {
    app: { patch: (_path, _auth, callback) => { handler = callback; } },
    requireAuth: () => {},
    selectRows: async (table) => table === 'deadlines' ? [current] : [{ field: 'Japan', difficulty: 'Easy', price: 100000 }],
    updateDeadlineAndGoogleSheet: async (_key, updates) => { current = { ...current, ...updates }; return current; },
    decorateDeadlineTiming: (row) => row
  });
  const from = server.indexOf("app.patch('/api/deadlines/:seriesId/:chapterNumber',");
  const to = server.indexOf('\napp.', from + 1);
  vm.runInContext(server.slice(from, to), context);
  async function patch(body) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
    await handler({ params: { seriesId: '1', chapterNumber: '1' }, authUser: { role: 'Admin' }, body }, res);
    return res;
  }
  for (const [index, expected] of [80000, 72000, 56000, 40000, 0].entries()) {
    const res = await patch({ late: options[index] });
    assert.equal(res.code, 200, res.payload.message);
    assert.equal(res.payload.data.receivePrice, expected.toFixed(2));
  }
  assert.equal((await patch({ late: 'bad' })).code, 400);
});

test('existing rows and salary fallback use late without deducting stored net earnings twice', () => {
  const context = contextFor(server, { decorateDeadlineTiming: (row) => row });
  vm.runInContext(['applyConfiguredPrices', 'getDeadlineEarning'].map((name) => extract(server, name)).join('\n'), context);
  const rows = options.map((late) => ({ price: 100000, completionPercent: 100, late, receivePrice: 100000 }));
  const priced = context.applyConfiguredPrices(rows, []);
  assert.deepEqual(Array.from(priced, (row) => context.getDeadlineEarning(row)), [100000, 90000, 70000, 50000, 0]);
  assert.equal(context.getDeadlineEarning({ price: 100000, completionPercent: 80, late: '3~6h' }), 56000);
  assert.equal(context.getDeadlineEarning({ receivePrice: 0, price: 100000, late: '>10h' }), 0);
});

test('Sheet sync recalculates net money while retaining pricing fields missing from the Sheet', () => {
  const from = server.indexOf('      const rowAllowedColumns = allowedColumns.filter(');
  const to = server.indexOf("      if (Object.prototype.hasOwnProperty.call(synchronizedRow, 'assignedAt'))", from);
  function syncPricing(current, row, sheetColumns) {
    const context = contextFor(server, {
      current, row, synchronizedRow: { ...row }, fieldOverride: null, headerIndex: new Map(),
      allowedColumns: ['price', 'completionPercent', 'late', 'receivePrice'],
      getGoogleSheetHeaderIndex: (_headers, key) => sheetColumns.includes(key) ? 1 : undefined
    });
    vm.runInContext(`${server.slice(from, to)}\nglobalThis.columns = writeColumns;`, context);
    assert.ok(context.columns.includes('receivePrice'));
    return context.synchronizedRow.receivePrice;
  }
  const current = { price: 100000, completionPercent: 80, late: '3~6h' };
  assert.equal(syncPricing(current, { price: null, completionPercent: 100, receivePrice: null }, []), '56000.00');
  assert.equal(syncPricing(current, { price: null, completionPercent: 100, late: '>10h' }, ['late']), '0.00');
  assert.equal(syncPricing(current, { price: 200000, completionPercent: 100 }, ['price', 'completionPercent']), '140000.00');
  assert.equal(syncPricing(undefined, { price: 100000, completionPercent: 100, late: '1~3h' }, ['late']), '90000.00');
});
