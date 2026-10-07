import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the production helpers/routes without starting the server or using
// real credentials. All Sheet and database writes are captured below.
const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const extract = (name) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, name);
  return match[0];
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const url = 'https://docs.google.com/spreadsheets/d/book/edit#gid=7';
const current = { id: 42, field: 'Japan', title: 'Series', chapter: '3', error: 'Missing text', editor: 'Alice', editorFreelancerId: 9, fixCheck: false, sourceRow: 3, sourceUrl: url };
const checkbox = (value = false, values = []) => ({
  userEnteredValue: typeof value === 'boolean' ? { boolValue: value } : { stringValue: value },
  effectiveValue: typeof value === 'boolean' ? { boolValue: value } : { stringValue: value },
  dataValidation: { condition: { type: 'BOOLEAN', values: values.map((userEnteredValue) => ({ userEnteredValue })) } }
});
function fixture() {
  const values = [['Instructions'], ['Editor', 'Error', 'Fix/Check', 'Title', 'Chapter', 'Note'], ['Alice', 'Missing text', 'FALSE', 'Series', '3', 'Leave intact']];
  return { spreadsheetId: 'book', sheetId: 7, rangeMeta: { startRow: 0, startColumn: 0 },
    headerRowIndex: 1, values, cellData: [[], [], [{}, {}, checkbox()]], hiddenRows: new Set(), merges: [] };
}
function harness(sheet = fixture()) {
  const writes = [];
  const dbWrites = [];
  const rows = [{ ...current }];
  const context = vm.createContext({
    URL, URLSearchParams, console, Set, Map, Date, Promise,
    validationError: (message) => Object.assign(new Error(message), { statusCode: 400 }),
    authorizationError: (message) => Object.assign(new Error(message), { statusCode: 403 }),
    getSafeErrorMessage: (error) => error.message,
    getGeneralSettings: async () => ({ errorSheetUrls: { Japan: url } }),
    getConfiguredErrorSheetUrl: (urls, field) => urls[field] || '',
    getCollection: async (name) => name === 'errors' ? rows : [{ id: 9, name: 'Alice' }],
    updateRowById: async (table, id, updates, columns) => {
      dbWrites.push({ table, id, updates: { ...updates }, columns });
      Object.assign(rows.find((row) => row.id === id), updates);
      return { ...rows.find((row) => row.id === id) };
    },
    readErrorGoogleSheet: async (_field, _url, options) => { assert.equal(options.includeImages, false); return sheet; },
    googleSheetsRequest: async (path, options) => { writes.push(plain({ path, options })); return {}; },
    normalizeStoredFields: (fields, field) => fields || [field],
    SYNC_WRITE_CONCURRENCY: 8
  });
  const block = source.slice(source.indexOf('const ERROR_TYPE_OPTIONS'), source.indexOf('function getErrorSheetHeaderIndex'));
  vm.runInContext([
    block,
    ...['normalizeSheetHeader', 'parseGoogleSheetReference', 'parseImportedBoolean', 'resolveErrorEditor', 'getFreelancerId',
      'filterErrorRowsForUser', 'canManagerManageField', 'assertManagerCanManageField', 'runWithConcurrency',
      'validateFreelancerErrorUpdatePayload', 'validateErrorUpdatePayload', 'parseBooleanInput', 'nullableText'].map(extract)
  ].join('\n'), context);
  return { context, writes, dbWrites, rows, sheet };
}

test('tick and untick write exactly one existing cell, preserving all other fields', async () => {
  const { context, writes, sheet } = harness();
  const original = plain(sheet);
  await context.writeErrorFixCheck(current, true);
  await context.writeErrorFixCheck(current, false);
  for (const [index, checked] of [true, false].entries()) {
    assert.deepEqual(writes[index], {
      path: 'spreadsheets/book:batchUpdate', options: { method: 'POST', body: { requests: [{ updateCells: {
        range: { sheetId: 7, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 3 },
        rows: [{ values: [{ userEnteredValue: { boolValue: checked } }] }], fields: 'userEnteredValue'
      } }] } }
    });
  }
  assert.deepEqual(plain(sheet), original);
});

test('custom checkbox values round trip, including single-value and formula-looking text', async () => {
  for (const values of [['Done', 'Pending'], ['Yes'], ['=literal', 'No'], ['1', '0']]) {
    const { context, sheet, writes } = harness();
    for (const checked of [true, false]) {
      const value = values[checked ? 0 : 1] ?? '';
      sheet.cellData[2][2] = checkbox(value, values);
      assert.equal(context.readErrorCheckbox(sheet.cellData[2][2]), checked);
      await context.writeErrorFixCheck(current, checked);
      assert.deepEqual(writes.at(-1).options.body.requests[0].updateCells.rows[0].values[0], { userEnteredValue: { stringValue: value } });
    }
  }
});

test('Sheet checkbox changes update only Fix/Check in the database, without Sheet writes', async () => {
  const { context, sheet, rows, writes, dbWrites } = harness();
  for (const checked of [true, false]) {
    sheet.cellData[2][2] = checkbox(checked);
    const result = await context.refreshErrorFixChecks({ role: 'Freelancer', freelancerId: 9 });
    assert.deepEqual(plain(result), { rows: [{ id: 42, fixCheck: checked }], warnings: [] });
    assert.equal(rows[0].fixCheck, checked);
    assert.deepEqual(Object.keys(dbWrites.at(-1).updates).sort(), ['fixCheck', 'updatedAt']);
  }
  assert.equal(writes.length, 0);
});

const unsafeCases = {
  'moved row': (sheet) => { sheet.values.splice(2, 0, ['New row']); sheet.cellData.splice(2, 0, []); },
  'deleted row': (sheet) => { sheet.values.pop(); },
  'changed title': (sheet) => { sheet.values[2][3] = 'Other series'; },
  'reassigned editor': (sheet) => { sheet.values[2][0] = 'Bob'; },
  'duplicate row': (sheet) => { sheet.values.push([...sheet.values[2]]); },
  'missing header': (sheet) => { sheet.values[1][2] = ''; },
  'duplicate header': (sheet) => { sheet.values[1].push('Fix/Check'); },
  'ambiguous alias': (sheet) => { sheet.values[1].push('Done'); },
  'plain text cell': (sheet) => { sheet.cellData[2][2] = { userEnteredValue: { stringValue: 'FALSE' } }; },
  'formula cell': (sheet) => { sheet.cellData[2][2].userEnteredValue = { formulaValue: '=TRUE()' }; },
  'merged cell': (sheet) => { sheet.merges = [{ startRowIndex: 2, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 4 }]; },
  'hidden row': (sheet) => { sheet.hiddenRows.add(2); },
  'wrong tab': (sheet) => { sheet.sheetId = 8; },
  'wrong workbook': (sheet) => { sheet.spreadsheetId = 'other'; }
};
for (const [name, mutate] of Object.entries(unsafeCases)) {
  test(`${name} refuses writing and preserves database on background refresh`, async () => {
    const { context, sheet, writes, dbWrites } = harness();
    mutate(sheet);
    await assert.rejects(context.writeErrorFixCheck(current, true));
    const result = await context.refreshErrorFixChecks({ role: 'Admin' });
    assert.ok(result.warnings.length);
    assert.equal(writes.length, 0);
    assert.equal(dbWrites.length, 0);
  });
}

test('app-only row never appends to Sheet; unresolved tab requires reimport', async () => {
  const { context, writes } = harness();
  await context.writeErrorFixCheck({ ...current, sourceRow: null }, true);
  await assert.rejects(context.writeErrorFixCheck({ ...current, sourceUrl: 'https://docs.google.com/spreadsheets/d/book/edit' }, true));
  assert.equal(writes.length, 0);
});

test('query and fragment gid, including tab zero, resolve correctly', () => {
  const { context } = harness();
  for (const suffix of ['?gid=0', '#gid=0', '?x=1#gid=0']) {
    assert.equal(context.parseGoogleSheetReference(`https://docs.google.com/spreadsheets/d/book/edit${suffix}`).gid, '0');
  }
});

test('Freelancer cannot refresh or tick another assignee; QC cannot tick another field', async () => {
  const { context, dbWrites } = harness();
  assert.deepEqual(plain(await context.refreshErrorFixChecks({ role: 'Freelancer', freelancerId: 10 })), { rows: [], warnings: [] });
  assert.throws(() => context.validateFreelancerErrorUpdatePayload({ fixCheck: true }, current, { freelancerId: 10 }), /được giao/);
  assert.throws(() => context.validateFreelancerErrorUpdatePayload({ title: 'X', fixCheck: true }, current, { freelancerId: 9 }), /Fix\/Check/);
  await assert.rejects(context.validateErrorUpdatePayload({ fixCheck: true }, { role: 'QC', fields: ['Korea'] }, current), /quyền/);
  assert.equal(dbWrites.length, 0);
});

test('Freelancer can edit, clear, or use an image Note on their assigned error', () => {
  const { context } = harness();
  const user = { role: 'Freelancer', freelancerId: '9' };
  for (const [note, expected] of [['  Đã sửa lỗi  ', 'Đã sửa lỗi'], ['', null], [null, null], ['data:image/png;base64,aGVsbG8=', 'data:image/png;base64,aGVsbG8=']]) {
    assert.deepEqual(plain(context.validateFreelancerErrorUpdatePayload({ note }, current, user)), { note: expected });
  }
  assert.deepEqual(plain(context.validateFreelancerErrorUpdatePayload({ note: 'Đã sửa', fixCheck: true }, current, user)), { note: 'Đã sửa', fixCheck: true });
});

test('Freelancer Note edits reject other assignments, missing profiles, and protected fields', () => {
  const { context } = harness();
  assert.throws(() => context.validateFreelancerErrorUpdatePayload({ note: 'Changed' }, current, { freelancerId: 10 }), /được giao/);
  assert.throws(() => context.validateFreelancerErrorUpdatePayload({ note: 'Changed' }, { ...current, editorFreelancerId: null }, {}), /được giao/);
  for (const key of ['field', 'title', 'chapter', 'errorType', 'screenshot', 'error', 'editor', 'editorFreelancerId', 'sourceRow', 'sourceUrl']) {
    assert.throws(() => context.validateFreelancerErrorUpdatePayload({ note: 'Changed', [key]: 'Changed' }, current, { freelancerId: 9 }), /chỉ được cập nhật/);
  }
  assert.throws(() => context.validateFreelancerErrorUpdatePayload({}, current, { freelancerId: 9 }), /Cần có/);
});

test('PATCH Note saves only Note and timestamp; unauthorized edits do not write', async () => {
  for (const [freelancerId, body, expectedCode] of [[9, { note: 'Đã sửa' }, 200], [10, { note: 'Changed' }, 403], [9, { note: 'Changed', title: 'Changed' }, 403]]) {
    const { context, rows, writes, dbWrites } = harness();
    let route;
    context.app = { patch: (_path, _auth, handler) => { route = handler; } };
    context.requireAuth = () => {};
    vm.runInContext(source.slice(source.indexOf("app.patch('/api/errors/:id'"), source.indexOf("app.delete('/api/errors/:id'")), context);
    const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await route({ params: { id: '42' }, authUser: { role: 'Freelancer', freelancerId }, body }, response);
    assert.equal(response.code, expectedCode);
    assert.equal(writes.length, 0);
    assert.equal(dbWrites.length, expectedCode === 200 ? 1 : 0);
    assert.equal(rows[0].title, current.title);
    assert.equal(rows[0].fixCheck, current.fixCheck);
    if (expectedCode === 200) {
      assert.equal(rows[0].note, body.note);
      assert.deepEqual(Object.keys(dbWrites[0].updates).sort(), ['note', 'updatedAt']);
    }
  }
});

test('operation queue keeps old reads ahead of later writes and recovers after failure', async () => {
  const { context } = harness();
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = context.withErrorSheetLock(async () => { events.push('read'); await gate; events.push('import'); });
  const second = context.withErrorSheetLock(async () => { events.push('write'); throw new Error('failed'); });
  const third = context.withErrorSheetLock(async () => { events.push('retry'); });
  await Promise.resolve();
  assert.deepEqual(events, ['read']);
  release();
  await first;
  await assert.rejects(second, /failed/);
  await third;
  assert.deepEqual(events, ['read', 'import', 'write', 'retry']);
});

test('PATCH awaits Sheet success before saving DB and reports Sheet failure without saving', async () => {
  for (const fails of [false, true]) {
    const { context, rows, dbWrites } = harness();
    let route;
    context.app = { patch: (_path, _auth, handler) => { route = handler; } };
    context.requireAuth = () => {};
    context.googleSheetsRequest = async () => {
      assert.equal(dbWrites.length, 0);
      if (fails) throw new Error('Sheet permission denied');
      return {};
    };
    vm.runInContext(source.slice(source.indexOf("app.patch('/api/errors/:id'"), source.indexOf("app.delete('/api/errors/:id'")), context);
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await route({ params: { id: '42' }, authUser: { role: 'Freelancer', freelancerId: 9 }, body: { fixCheck: true } }, response);
    assert.equal(response.code, fails ? 502 : 200);
    assert.equal(dbWrites.length, fails ? 0 : 1);
    assert.equal(rows[0].fixCheck, !fails);
  }
});

test('checkbox-only reader selects the URL tab and never extracts images', async () => {
  const { context } = harness();
  context.getGoogleSheetMetadata = async () => ({ sheets: [{ properties: { sheetId: 0, title: 'Wrong' } }, { properties: { sheetId: 7, title: 'Errors' } }] });
  context.readGoogleSheetValues = async (_id, range) => {
    assert.equal(range, "'Errors'!A:ZZ");
    return { values: [['Title', 'Chapter', 'Error', 'Editor', 'Screenshot', 'Fix/Check']], cellData: [] };
  };
  context.readGoogleSheetImageCells = async () => assert.fail('Must not export/copy screenshots during checkbox sync');
  vm.runInContext(['readErrorGoogleSheet', 'getErrorSheetHeaderIndex', 'findErrorSheetHeaderRow', 'quoteGoogleSheetTitle', 'parseGoogleSheetA1Range', 'googleSheetColumnToIndex'].map(extract).join('\n'), context);
  const sheet = await context.readErrorGoogleSheet('Japan', url, { includeImages: false });
  assert.equal(sheet.sheetId, 7);
  assert.match(sheet.sourceUrl, /\?gid=7$/);
});
