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

function harness() {
  const context = vm.createContext({
    Map,
    Set,
    Promise,
    googleSheetIndexToColumn: (index) => String.fromCharCode(65 + Number(index)),
    getGoogleSheetHeaderIndex: (_headerIndex, key) => key === 'status' ? 1 : undefined,
    readGoogleSheetValues: async (_spreadsheetId, range) => ({
      values: range === "'Status options'!A1:A5"
        ? [['Doing'], ['Submitted'], ['Checking'], ['Fixing'], ['Done']]
        : []
    })
  });
  vm.runInContext([
    extract('normalizeStatusOption'),
    extract('getGoogleSheetConditionValue'),
    extract('getGoogleSheetStatusCondition'),
    extract('getGoogleSheetStatusOptions'),
    extract('hydrateGoogleSheetStatusOptions'),
    extract('getGoogleSheetStatusValue'),
    extract('getGoogleSheetStatusRepair')
  ].join('\n'), context);
  return context;
}

function tabWithValidation(condition) {
  return {
    sheetTitle: 'Japan',
    startRow: 0,
    startColumn: 0,
    headerIndex: new Map([['status', 1]]),
    values: [
      ['seriesId', 'status'],
      ['100', 'Doing']
    ],
    cellData: [
      [],
      [{}, { dataValidation: { condition } }]
    ]
  };
}

test('web status is written using the exact existing dropdown label', () => {
  const context = harness();
  const tab = tabWithValidation({
    type: 'ONE_OF_LIST',
    values: [
      { userEnteredValue: 'Doing' },
      { userEnteredValue: 'Submitted' },
      { userEnteredValue: 'Checking' },
      { userEnteredValue: 'Fixing' },
      { userEnteredValue: 'Done' }
    ]
  });

  assert.equal(context.getGoogleSheetStatusValue(tab, 2, { status: 'doing' }, 1), 'Doing');
  assert.equal(context.getGoogleSheetStatusValue(tab, 2, { status: 'submitted' }, 1), 'Submitted');
});

test('range-backed dropdowns are resolved before writing the status', async () => {
  const context = harness();
  const tab = tabWithValidation({
    type: 'ONE_OF_RANGE',
    values: [{ userEnteredValue: "'Status options'!A1:A5" }]
  });

  await context.hydrateGoogleSheetStatusOptions('book', tab);
  assert.equal(context.getGoogleSheetStatusValue(tab, 2, { status: 'done' }, 1), 'Done');
});

test('a validated status cell refuses an unknown option instead of writing invalid plain text', () => {
  const context = harness();
  const tab = tabWithValidation({
    type: 'ONE_OF_LIST',
    values: [{ userEnteredValue: 'Doing' }, { userEnteredValue: 'Submitted' }]
  });

  assert.throws(
    () => context.getGoogleSheetStatusValue(tab, 2, { status: 'done' }, 1),
    /Không tìm thấy option/
  );
});

test('the repair pass detects old lowercase values and leaves already-correct chips untouched', () => {
  const context = harness();
  const tab = tabWithValidation({
    type: 'ONE_OF_LIST',
    values: [{ userEnteredValue: 'Doing' }, { userEnteredValue: 'Submitted' }]
  });

  assert.equal(
    JSON.stringify(context.getGoogleSheetStatusRepair(tab, 2, { status: 'doing' }, ['100', 'doing'])),
    JSON.stringify({ columnIndex: 1, currentValue: 'doing', expectedValue: 'Doing' })
  );
  assert.equal(context.getGoogleSheetStatusRepair(tab, 2, { status: 'doing' }, ['100', 'Doing']), null);
});
