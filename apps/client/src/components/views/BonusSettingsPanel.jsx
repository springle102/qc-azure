import React, { useState } from 'react';
import { resolveBonusRule, validateBonusRule } from '../../utils/bonus.mjs';
import { api } from '../../services/api';
import { showToast } from '../common/ToastContainer';

const money = (value) => `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ₫`;

export function BonusSettingsPanel({ field, settings, isLoading, onRefresh }) {
  const [draft, setDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const config = draft || resolveBonusRule(settings);
  const update = (key, value) => setDraft({ ...config, [key]: value });
  let rule;
  let validationMessage;
  try {
    rule = validateBonusRule(config);
  } catch (error) {
    validationMessage = error.message;
  }
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
        <h3>Thưởng cộng dồn — {field}</h3>
        <p className="form-help">Tính trên tất cả chap đã tick Thanh toán của mỗi freelancer trong mảng này, không chia theo tháng hoặc lọc theo status.</p>
      </div>
      <form className="bonus-policy-form" onSubmit={save}>
        <div className="bonus-policy-grid">
          <fieldset className="bonus-policy-card" disabled={isSaving || isLoading}>
            <legend>Thưởng đạt KPI</legend>
            <label className="bonus-policy-toggle"><input type="checkbox" checked={config.kpiEnabled} onChange={(event) => update('kpiEnabled', event.target.checked)} /> Bật thưởng KPI</label>
            <label className="form-group">Mốc KPI (chap)
              <input className="form-input" type="number" min="1" max="1000000" step="1" required value={config.kpiThreshold} disabled={!config.kpiEnabled} onChange={(event) => update('kpiThreshold', event.target.value)} />
            </label>
            <label className="form-group">Tiền thưởng một lần (đồng)
              <input className="form-input" type="number" min="0" step="0.01" required value={config.kpiAmount} disabled={!config.kpiEnabled} onChange={(event) => update('kpiAmount', event.target.value)} />
            </label>
            <p className="form-help">Đủ {config.kpiThreshold || '…'} chap đầu tiên đã tick Thanh toán và đều đạt từ 100% → nhận {money(config.kpiAmount)} một lần, không đặt lại mốc mỗi tháng.</p>
          </fieldset>
          <fieldset className="bonus-policy-card" disabled={isSaving || isLoading}>
            <legend>Thưởng sau mốc hoàn thành</legend>
            <label className="bonus-policy-toggle"><input type="checkbox" checked={config.afterEnabled} onChange={(event) => update('afterEnabled', event.target.checked)} /> Bật thưởng sau mốc</label>
            <label className="form-group">Mốc cần hoàn thành (chap)
              <input className="form-input" type="number" min="1" max="1000000" step="1" required value={config.afterThreshold} disabled={!config.afterEnabled} onChange={(event) => update('afterThreshold', event.target.value)} />
            </label>
            <label className="form-group">Thưởng mỗi chap sau mốc (đồng)
              <input className="form-input" type="number" min="0" step="0.01" required value={config.afterAmount} disabled={!config.afterEnabled} onChange={(event) => update('afterAmount', event.target.value)} />
            </label>
            <p className="form-help">{config.afterThreshold || '…'} chap đầu đều đạt từ 100% → thưởng {money(config.afterAmount)}/chap từ chap thứ {Number(config.afterThreshold || 0) + 1}. Chap sau mốc cũng phải đạt từ 100%.</p>
          </fieldset>
        </div>
        <fieldset className="bonus-policy-card" disabled={isSaving || isLoading}>
          <legend>Tiền QC</legend>
          <label className="form-group">Giá mặc định QC / task (đồng)
            <input className="form-input" type="number" min="0" step="0.01" required value={config.qcDefaultPrice} onChange={(event) => update('qcDefaultPrice', event.target.value)} />
          </label>
        </fieldset>
        <div className="bonus-settings-actions"><button type="submit" className="btn btn-primary" disabled={isSaving || isLoading}>{isSaving ? 'Đang lưu...' : `Lưu bonus ${field}`}</button></div>
      </form>
    </section>
  );
}
