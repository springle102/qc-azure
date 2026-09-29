import React, { useState } from 'react';
import { getBonusPreview, resolveBonusRule, validateBonusRule } from '../../utils/bonus.mjs';
import { api } from '../../services/api';
import { showToast } from '../common/ToastContainer';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;

export function BonusSettingsPanel({ field, settings, isLoading, onRefresh }) {
  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState('25');
  const [partialChapters, setPartialChapters] = useState('');
  const config = draft || resolveBonusRule(settings);
  const update = (key, value) => setDraft({ ...config, [key]: value });
  let rule;
  let validationMessage;
  try {
    rule = validateBonusRule(config);
  } catch (error) {
    validationMessage = error.message;
  }
  const count = Number(previewCount);
  const partial = partialChapters.trim() ? partialChapters.split(',').map((value) => Number(value.trim())) : [];
  const canPreview = rule && previewCount !== '' && Number.isInteger(count) && count >= 0 && count <= 1000
    && partial.every((value) => Number.isInteger(value) && value >= 1 && value <= count);
  const preview = canPreview ? getBonusPreview(Array.from({ length: count }, (_, index) => ({
    seriesId: 1, chapterNumber: String(index + 1), submittedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    completionPercent: partial.includes(index + 1) ? 90 : 100
  })), rule) : null;

  const save = async (event) => {
    event.preventDefault();
    if (!rule) return showToast(validationMessage, 'error');
    setIsSaving(true);
    try {
      await api.updateBonusSettings({ field, ...rule });
      await onRefresh?.();
      setDraft(null);
      showToast(`Đã lưu bonus ${field}. Chỉ các chap đã tick Thanh toán được tính.`, 'success');
    } catch (error) {
      showToast(error.message || 'Không thể lưu cấu hình bonus.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="glass-panel bonus-settings-panel">
      <div className="bonus-settings-header">
        <span className="qc-kicker">BONUS FREELANCER · {field}</span>
        <h3>Thưởng theo tháng — {field}</h3>
        <p className="form-help">Hai cơ chế bật độc lập và cộng dồn. Chỉ các chap đã tick Thanh toán được tính; toàn bộ chap đạt mốc phải hoàn thành đúng 100%.</p>
      </div>
      <form className="bonus-policy-form" onSubmit={save}>
        <div className="bonus-policy-grid">
          <fieldset className="bonus-policy-card" disabled={isSaving || isLoading}>
            <legend>Thưởng đạt KPI</legend>
            <label className="bonus-policy-toggle"><input type="checkbox" checked={config.kpiEnabled} onChange={(event) => update('kpiEnabled', event.target.checked)} /> Bật thưởng KPI</label>
            <label className="form-group">Mốc KPI (chap/tháng)
              <input className="form-input" type="number" min="1" max="1000000" step="1" required value={config.kpiThreshold} disabled={!config.kpiEnabled} onChange={(event) => update('kpiThreshold', event.target.value)} />
            </label>
            <label className="form-group">Tiền thưởng một lần (đồng)
              <input className="form-input" type="number" min="0" step="0.01" required value={config.kpiAmount} disabled={!config.kpiEnabled} onChange={(event) => update('kpiAmount', event.target.value)} />
            </label>
            <p className="form-help">Đủ {config.kpiThreshold || '…'} chap đầu tiên đều đạt 100% → nhận {money(config.kpiAmount)} một lần/tháng.</p>
          </fieldset>
          <fieldset className="bonus-policy-card" disabled={isSaving || isLoading}>
            <legend>Thưởng sau mốc hoàn thành</legend>
            <label className="bonus-policy-toggle"><input type="checkbox" checked={config.afterEnabled} onChange={(event) => update('afterEnabled', event.target.checked)} /> Bật thưởng sau mốc</label>
            <label className="form-group">Mốc cần hoàn thành (chap/tháng)
              <input className="form-input" type="number" min="1" max="1000000" step="1" required value={config.afterThreshold} disabled={!config.afterEnabled} onChange={(event) => update('afterThreshold', event.target.value)} />
            </label>
            <label className="form-group">Thưởng mỗi chap sau mốc (đồng)
              <input className="form-input" type="number" min="0" step="0.01" required value={config.afterAmount} disabled={!config.afterEnabled} onChange={(event) => update('afterAmount', event.target.value)} />
            </label>
            <p className="form-help">{config.afterThreshold || '…'} chap đầu đều đạt 100% → thưởng {money(config.afterAmount)}/chap từ chap thứ {Number(config.afterThreshold || 0) + 1}. Chap sau mốc cũng phải đạt 100%.</p>
          </fieldset>
        </div>
        <p className="form-help">Đếm riêng từng freelancer và mảng theo kỳ lương đang xem. Chỉ task Submitted/Done đã tick Thanh toán được đưa vào mốc bonus. Không bỏ qua chap dưới 100% để thay bằng chap phía sau.</p>
        <fieldset className="bonus-policy-card" disabled={isSaving || isLoading}>
          <legend>Tiền QC</legend>
          <label className="form-group">Giá mặc định QC / task (đồng)
            <input className="form-input" type="number" min="0" step="0.01" required value={config.qcDefaultPrice} onChange={(event) => update('qcDefaultPrice', event.target.value)} />
          </label>
          <p className="form-help">QC nhận thêm phần tiền tương ứng với % freelancer chưa hoàn thành. Hai cơ chế bonus bên trên chỉ áp dụng cho freelancer.</p>
        </fieldset>
        <details className="bonus-preview">
          <summary>Xem thử tiền thưởng</summary>
          <div className="bonus-policy-grid">
            <label className="form-group">Số chap trong tháng (0–1.000)
              <input className="form-input" type="text" inputMode="numeric" value={previewCount} onChange={(event) => setPreviewCount(event.target.value)} />
            </label>
            <label className="form-group">Thứ tự chap chưa đạt 100%
              <input className="form-input" placeholder="Ví dụ: 3, 8 (để trống nếu tất cả đạt)" value={partialChapters} onChange={(event) => setPartialChapters(event.target.value)} />
            </label>
          </div>
          {preview ? <div aria-live="polite">
            <p>KPI: {money(preview.kpi.amount)} — {describeBonusGate(preview.kpi)}</p>
            <p>Sau mốc: {preview.after.rewardedCount} chap × {money(rule.afterAmount)} = {money(preview.after.amount)} — {describeBonusGate(preview.after)}</p>
            <strong>Tổng bonus: {money(preview.total)}</strong>
          </div> : <p className="form-help">{validationMessage || 'Nhập số chap và danh sách thứ tự chap hợp lệ để xem thử.'}</p>}
        </details>
        <div className="bonus-settings-actions"><button type="submit" className="btn btn-primary" disabled={isSaving || isLoading}>{isSaving ? 'Đang lưu...' : `Lưu bonus ${field}`}</button></div>
      </form>
    </section>
  );
}

function describeBonusGate(gate) {
  if (!gate.enabled) return 'Đã tắt';
  if (gate.unlocked) return 'Đã đạt mốc';
  return [gate.missingCount > 0 ? `Còn thiếu ${gate.missingCount} chap` : '',
    gate.blockedChapters.length > 0 ? `${gate.blockedChapters.length} chap trong mốc chưa đạt 100%` : ''].filter(Boolean).join('; ');
}
