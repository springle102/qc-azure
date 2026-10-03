import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/views/SalaryManagementView.jsx', import.meta.url), 'utf8');
const totalsFrom = source.indexOf('  const salaryTotals = useMemo(');
const totalsTo = source.indexOf('  const updateColumnSort', totalsFrom);
const formatFrom = source.indexOf('function formatSalary(');
const formatTo = source.indexOf('function getMemberFields(', formatFrom);
const combinedCell = source.match(/<td className="salary-cell salary-combined-total"[^>]*>\s*\{([^}]+)\}\s*<\/td>/);
assert.ok(totalsFrom >= 0 && totalsTo > totalsFrom);
assert.ok(formatFrom >= 0 && formatTo > formatFrom);
assert.ok(combinedCell, 'Combined sum must be rendered in the final footer cell');
assert.match(source.slice(source.indexOf('<tfoot>'), source.indexOf('</tfoot>')), /salary-combined-total[\s\S]*<\/td>\s*<\/tr>/);

function renderCombinedTotal(filteredFreelancers, isLoading = false) {
  const context = vm.createContext({ filteredFreelancers, isLoading, useMemo: (callback) => callback() });
  return vm.runInContext(`${source.slice(totalsFrom, totalsTo)}\n${source.slice(formatFrom, formatTo)}\n${combinedCell[1]}`, context);
}

test('last footer cell adds the two displayed amounts without changing salary data', () => {
  const rows = [{ totalSalary: 4720000, bonus: 10000 }];
  assert.equal(renderCombinedTotal(rows), '4,730,000 ₫');
  assert.deepEqual(rows, [{ totalSalary: 4720000, bonus: 10000 }]);
});

test('combined total uses filtered rows, QC transfers and integer cents', () => {
  assert.equal(renderCombinedTotal([
    { totalSalary: '0.10', bonus: '0.20' },
    { isQc: true, totalSalary: '0.30', transferredAmount: '0.40', bonus: 999 }
  ]), '1 ₫');
  assert.equal(renderCombinedTotal([{ salary: '2000', bonus: '300' }]), '2,300 ₫');
  assert.equal(renderCombinedTotal([{ luong: '1000', bonus: 'invalid' }]), '1,000 ₫');
});

test('empty and loading states stay consistent with the other footer cells', () => {
  assert.equal(renderCombinedTotal([]), '0 ₫');
  assert.equal(renderCombinedTotal([{ totalSalary: 'invalid' }]), '0 ₫');
  assert.equal(renderCombinedTotal([{ totalSalary: 100, bonus: 10 }], true), 'Đang tải...');
});
