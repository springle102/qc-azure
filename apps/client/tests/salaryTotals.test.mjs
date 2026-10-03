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

test('last footer cell does not add bonus a second time or change salary data', () => {
  const rows = [{ totalSalary: 4720000, bonus: 10000 }];
  assert.equal(renderCombinedTotal(rows), '4,720,000 ₫');
  assert.deepEqual(rows, [{ totalSalary: 4720000, bonus: 10000 }]);
});

test('payable total uses filtered rows and integer cents without adding QC transfers again', () => {
  assert.equal(renderCombinedTotal([
    { totalSalary: '0.10', bonus: '0.20' },
    { isQc: true, totalSalary: '0.30', transferredAmount: '0.40', bonus: 999 }
  ]), '0.4 ₫');
  assert.equal(renderCombinedTotal([{ salary: '2000', bonus: '300' }]), '2,000 ₫');
  assert.equal(renderCombinedTotal([{ luong: '1000', bonus: 'invalid' }]), '1,000 ₫');
});

test('a QC receiving 10000 in transferred earnings has zero bonus and a 10000 payable total', () => {
  const member = { isQc: true, totalSalary: '10000.00', transferredAmount: '10000.00', bonus: '0.00' };
  assert.equal(renderCombinedTotal([member]), '10,000 ₫');

  const context = vm.createContext({ filteredFreelancers: [member], useMemo: (callback) => callback() });
  assert.equal(vm.runInContext(`${source.slice(totalsFrom, totalsTo)}\nsalaryTotals.bonusCents`, context), 0);

  const qcBonusCell = source.match(/freelancer\.isQc \? (formatSalary\([^)]*\)) : \(/);
  assert.ok(qcBonusCell, 'QC bonus must be rendered separately from freelancer bonus details');
  const cellContext = vm.createContext({ freelancer: member });
  assert.equal(vm.runInContext(`${source.slice(formatFrom, formatTo)}\n${qcBonusCell[1]}`, cellContext), '0 ₫');

  const sortFrom = source.indexOf('function getSalarySortValue(');
  const sortTo = source.indexOf('function compareSalaryRows(', sortFrom);
  const sortContext = vm.createContext({ member });
  assert.equal(vm.runInContext(`${source.slice(sortFrom, sortTo)}\ngetSalarySortValue(member, 'bonus')`, sortContext), 0);
});

test('bonus total contains freelancer bonuses only when mixed with QC rows', () => {
  const context = vm.createContext({
    filteredFreelancers: [
      { totalSalary: '120000.00', bonus: '20000.00' },
      { isQc: true, totalSalary: '10000.00', transferredAmount: '10000.00', bonus: '0.00' }
    ],
    useMemo: (callback) => callback()
  });
  assert.equal(vm.runInContext(`${source.slice(totalsFrom, totalsTo)}\nsalaryTotals.bonusCents`, context), 2000000);
});

test('empty and loading states stay consistent with the other footer cells', () => {
  assert.equal(renderCombinedTotal([]), '0 ₫');
  assert.equal(renderCombinedTotal([{ totalSalary: 'invalid' }]), '0 ₫');
  assert.equal(renderCombinedTotal([{ totalSalary: 100, bonus: 10 }], true), 'Đang tải...');
});
