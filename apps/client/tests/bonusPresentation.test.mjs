import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('bonus details and settings describe cumulative paid chapters, not monthly groups', () => {
  const salary = readFileSync(new URL('../src/components/views/SalaryManagementView.jsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../src/components/views/BonusSettingsPanel.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(salary, /summary\.salaryMonth|missingDateChapters|missingDateCount/);
  assert.match(salary, /key=\{summary\.field\}/);
  assert.match(salary, /Cộng dồn tất cả chap đã tick Thanh toán/);
  assert.match(settings, /Thưởng cộng dồn/);
  assert.doesNotMatch(settings, /chap\/tháng|một lần\/tháng|Thưởng theo tháng/);
});
