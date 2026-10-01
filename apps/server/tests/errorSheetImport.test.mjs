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
const plain = (value) => JSON.parse(JSON.stringify(value));
const headers = ['Title', 'Chapter', 'Error Type', 'Screenshot', 'Error', 'Note', 'Editor', 'Fix/Check'];
const url = 'https://docs.google.com/spreadsheets/d/book/edit?gid=7';
const image = 'https://example.com/screenshot.png';
const makeRow = (updates) => {
  const row = ['', '', '', '', '', '', '', 'FALSE'];
  for (const [column, value] of Object.entries(updates)) row[headers.indexOf(column)] = value;
  return row;
};

function harness(inputRows, existingRows = []) {
  const rows = existingRows.map((row) => ({ ...row }));
  const writes = [];
  const sheet = {
    field: 'Japan', sourceUrl: url, rangeMeta: { startRow: 0 }, headerRowIndex: 0,
    headerIndex: new Map(headers.map((header, index) => [header.toLowerCase().replace(/[^a-z0-9]/g, ''), index])),
    values: [headers, ...inputRows], cellData: [], imageCells: new Map(), hiddenRows: new Set()
  };
  const context = vm.createContext({
    URL, console, SYNC_WRITE_CONCURRENCY: 8,
    MAX_ERROR_SCREENSHOT_COUNT: 3, MAX_ERROR_SCREENSHOT_ITEM_LENGTH: 5 * 1024 * 1024,
    MAX_ERROR_SCREENSHOT_TOTAL_LENGTH: 15 * 1024 * 1024,
    crypto: { randomUUID: () => 'test' },
    getGeneralSettings: async () => ({ errorSheetUrls: { Japan: url } }),
    normalizeErrorSheetUrls: (urls) => urls,
    getCollection: async (name) => name === 'errors' ? rows : [{ fIld: 9, name: 'Alice' }],
    readErrorGoogleSheet: async () => sheet,
    materializeErrorScreenshot: async (value) => value,
    getStoragePathsFromErrorScreenshot: () => [],
    insertRow: async (_table, payload) => {
      writes.push({ type: 'insert', payload: plain(payload) });
      rows.push({ id: 100 + rows.length, ...plain(payload) });
    },
    updateRowById: async (_table, id, payload) => {
      writes.push({ type: 'update', id, payload: plain(payload) });
      Object.assign(rows.find((row) => row.id === id), plain(payload));
    },
    deleteRowById: async (_table, id) => {
      writes.push({ type: 'delete', id });
      rows.splice(rows.findIndex((row) => row.id === id), 1);
    }
  });
  vm.runInContext([
    source.slice(source.indexOf('const ERROR_TYPE_OPTIONS'), source.indexOf('// Serialize imports, checkbox reads')),
    ...['normalizeSheetHeader', 'getErrorSheetHeaderIndex', 'getErrorSheetValue', 'readErrorCheckbox',
      'parseImportedBoolean', 'isDecorativeErrorSheetRow', 'getFreelancerId', 'resolveErrorEditor',
      'buildImportedError', 'parseErrorScreenshotValues', 'normalizeErrorScreenshot', 'getErrorScreenshotValues',
      'isHttpUrl', 'nullableText', 'normalizeErrorType', 'normalizeStoredFields', 'isValidConfiguredFieldName',
      'canManagerManageField', 'normalizeErrorSyncValue', 'hasErrorSheetChanges', 'runWithConcurrency',
      'syncErrorsWithGoogleSheets'].map(extract)
  ].join('\n'), context);
  return { context, sheet, rows, writes, sync: () => context.syncErrorsWithGoogleSheets({ role: 'Admin' }) };
}

test('imports missing Error, missing Title/Chapter, and rows with only one populated column', async () => {
  const input = [
    makeRow({ Title: 'Series', Chapter: '3', Editor: 'Alice' }),
    ...headers.slice(0, -1).map((column) => makeRow({ [column]: column === 'Screenshot' ? image : column === 'Error Type' ? 'Text' : column === 'Editor' ? 'Alice' : 'Some data' })),
    makeRow({ 'Fix/Check': 'TRUE' })
  ];
  const { sync, rows } = harness(input);
  const result = await sync();
  assert.equal(result.inserted, input.length);
  assert.equal(result.skipped, 0);
  assert.equal(rows[0].error, '');
  assert.equal(rows[0].editorFreelancerId, 9);
  assert.equal(rows.at(-1).fixCheck, true);
  assert.deepEqual(rows.map((row) => row.sourceRow), input.map((_, index) => index + 2));
});

test('skips truly blank rows, whitespace and prefilled unchecked checkboxes', async () => {
  const { sync, rows, sheet } = harness([[], makeRow({}), makeRow({ Title: '  ', Error: '\t' }), makeRow({ 'Fix/Check': 'Pending' })]);
  sheet.cellData[4] = [];
  sheet.cellData[4][7] = { userEnteredValue: { stringValue: 'Pending' }, dataValidation: { condition: {
    type: 'BOOLEAN', values: [{ userEnteredValue: 'Done' }, { userEnteredValue: 'Pending' }]
  } } };
  assert.equal((await sync()).inserted, 0);
  assert.equal(rows.length, 0);
});

test('imports image-only rows and cell formulas even beyond the formatted values range', async () => {
  const { sync, rows, sheet } = harness([]);
  sheet.imageCells.set('1:3', image);
  sheet.imageCells.set('2:5', image);
  sheet.cellData[3] = [];
  sheet.cellData[3][3] = { userEnteredValue: { formulaValue: `=IMAGE("${image}")` } };
  sheet.cellData[4] = [];
  sheet.cellData[4][5] = { userEnteredValue: { stringValue: 'Only a note' } };
  sheet.imageCells.set('6:3', image);
  const result = await sync();
  assert.equal(result.inserted, 5);
  assert.deepEqual(rows.map((row) => row.sourceRow), [2, 3, 4, 5, 7]);
  assert.equal(rows[0].screenshot, image);
  assert.equal(rows[1].note, image);
  assert.equal(rows[2].screenshot, image);
  assert.equal(rows[3].note, 'Only a note');
});

test('a row whose Error is cleared updates the same record and repeated sync adds no duplicates', async () => {
  const { sync, rows, writes, sheet } = harness([makeRow({ Title: 'Series', Chapter: '3', Error: 'Old error', Editor: 'Alice' })]);
  await sync();
  const id = rows[0].id;
  sheet.values[1][4] = '';
  const result = await sync();
  assert.equal(result.updated, 1);
  assert.equal(result.deleted, 0);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].error, '');
  writes.length = 0;
  await sync();
  assert.deepEqual(writes, []);
  assert.equal(rows.length, 1);
});

test('imports populated hidden rows and removes only records whose source row becomes empty', async () => {
  const { sync, rows, sheet } = harness([makeRow({ Note: 'Keep this row' }), makeRow({ Error: 'Remove later' })]);
  sheet.hiddenRows.add(1);
  assert.equal((await sync()).inserted, 2);
  const keptId = rows[0].id;
  sheet.values[2] = makeRow({});
  assert.equal((await sync()).deleted, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, keptId);
});

test('QC full sync stays restricted to assigned fields', async () => {
  const { context } = harness([makeRow({ Note: 'Japan only' })]);
  context.getGeneralSettings = async () => ({ errorSheetUrls: { Japan: url, Latin: url } });
  context.readErrorGoogleSheet = async (field) => { assert.equal(field, 'Japan'); return harness([makeRow({ Note: 'Japan only' })]).sheet; };
  assert.equal((await context.syncErrorsWithGoogleSheets({ role: 'QC', fields: ['Japan'] })).inserted, 1);
});
