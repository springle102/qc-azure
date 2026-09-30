export const DEFAULT_BONUS_RULE = {
  kpiEnabled: false,
  kpiThreshold: 20,
  kpiAmount: 0,
  afterEnabled: true,
  afterThreshold: 20,
  afterAmount: 10000,
  qcDefaultPrice: 0
};

export function isSalaryMonth(value) {
  return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

const salaryMonthFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit'
});

export function getSalaryMonth(value = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(salaryMonthFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}`;
}

export function resolveBonusRule(row = {}) {
  const storedRule = row.bonusPolicy && !Array.isArray(row.bonusPolicy.versions)
    ? row.bonusPolicy
    : Array.isArray(row.bonusPolicy?.versions) ? row.bonusPolicy.versions.at(-1) : null;
  if (storedRule) return { ...DEFAULT_BONUS_RULE, ...storedRule };
  return {
    ...DEFAULT_BONUS_RULE,
    afterThreshold: Math.max(1, Number(row.taskThreshold ?? 20)),
    afterAmount: Number(row.bonusPerTask ?? 10000),
    qcDefaultPrice: Number(row.qcDefaultPrice ?? 0)
  };
}

export function validateBonusRule(payload) {
  const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!payload || typeof payload !== 'object') fail('Dữ liệu bonus không hợp lệ.');
  const result = {};
  for (const key of ['kpiEnabled', 'afterEnabled']) {
    if (typeof payload[key] !== 'boolean') fail('Trạng thái bật/tắt cơ chế phải hợp lệ.');
    result[key] = payload[key];
  }
  for (const key of ['kpiThreshold', 'afterThreshold', 'kpiAmount', 'afterAmount', 'qcDefaultPrice']) {
    const raw = payload[key];
    const value = Number(raw);
    if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '' || !Number.isFinite(value)) {
      fail('Vui lòng nhập đầy đủ mốc chap và số tiền hợp lệ.');
    }
    if (key.endsWith('Threshold')) {
      if (!Number.isInteger(value) || value < 1 || value > 1000000) fail('Mốc chap phải là số nguyên từ 1 đến 1.000.000.');
    } else if (value < 0 || value > 999999999999.99 || !/^\d+(\.\d{1,2})?$/.test(String(raw).trim())) {
      fail('Số tiền phải không âm và có tối đa 2 chữ số thập phân.');
    }
    result[key] = value;
  }
  return result;
}
