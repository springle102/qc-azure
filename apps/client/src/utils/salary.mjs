export function getSalaryAmounts(member) {
  const toCents = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;
  const bonusCents = member.isQc ? 0 : toCents(member.bonus);
  const hasEarnings = member.earnedAmount !== null && member.earnedAmount !== undefined && member.earnedAmount !== '';
  const legacyTotal = member.totalSalary ?? member.salary ?? member.luong;
  const salaryCents = hasEarnings
    ? toCents(member.earnedAmount) + (member.isQc ? toCents(member.transferredAmount) : 0)
    : (Number.isFinite(Number(legacyTotal)) ? toCents(legacyTotal) - bonusCents : 0);
  return { salaryCents, bonusCents, totalCents: salaryCents + bonusCents };
}
