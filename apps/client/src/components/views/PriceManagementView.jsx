import React, { useMemo, useState } from 'react';
import { IconEdit, IconPlus, IconRefresh, IconSearch, IconTasks, IconTrash, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const FIELDS = ['Latin', 'Japan', 'QC'];
const DEFAULT_BONUS_CONFIG = { taskThreshold: 20, bonusPerTask: 10000 };
const DEFAULT_LEVEL_COLOR = '#64748B';
const DEFAULT_LEVEL_TEXT_COLOR = '#FFFFFF';

export function PriceManagementView({ difficultyLevels = [], difficultyPrices = [], fields = [], bonusConfig, isLoading, onRefresh }) {
  const [field, setField] = useState('');
  const [search, setSearch] = useState('');
  const [editingPrice, setEditingPrice] = useState(null);
  const [levelManagerField, setLevelManagerField] = useState(null);
  const [editingLevel, setEditingLevel] = useState(null);
  const [bonusDraft, setBonusDraft] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const activeBonusConfig = bonusDraft ?? bonusConfig ?? DEFAULT_BONUS_CONFIG;
  const fieldNames = useMemo(() => fields.length > 0 ? fields.map((item) => item.name || item).filter(Boolean) : FIELDS, [fields]);

  const rows = useMemo(() => {
    const prices = new Map(difficultyPrices.map((item) => [priceKey(item.field, item.difficulty), item]));
    const query = search.trim().toLowerCase();

    return difficultyLevels
      .filter((level) => !field || level.field === field)
      .map((level) => ({ ...level, priceRow: prices.get(priceKey(level.field, level.difficulty)) }))
      .filter((level) => !query || [level.field, level.difficulty, level.priceRow?.price].some((value) => String(value ?? '').toLowerCase().includes(query)))
      .sort((left, right) => {
        const fieldDiff = fieldNames.indexOf(left.field) - fieldNames.indexOf(right.field);
        return fieldDiff || String(left.difficulty || '').localeCompare(String(right.difficulty || ''), 'vi');
      });
  }, [difficultyLevels, difficultyPrices, field, fieldNames, search]);

  const levelsForPriceField = editingPrice
    ? difficultyLevels.filter((level) => level.field === editingPrice.field)
    : [];

  const openCreatePrice = (fieldName = field || fieldNames[0] || '') => {
    const levels = difficultyLevels.filter((level) => level.field === fieldName);
    if (levels.length === 0) {
      showToast(`Hãy set độ khó cho mảng ${fieldName} trước.`, 'error');
      setLevelManagerField(fieldName);
      return;
    }
    setEditingPrice({ id: null, field: fieldName, difficulty: levels[0].difficulty, price: '' });
  };

  const openEditPrice = (row) => {
    if (!row.priceRow) return openCreatePrice(row.field);
    setEditingPrice({ id: row.priceRow.id, field: row.field, difficulty: row.difficulty, price: row.priceRow.price ?? '' });
  };

  const updatePriceField = (key, value) => {
    if (key === 'field') {
      const firstLevel = difficultyLevels.find((level) => level.field === value);
      setEditingPrice((current) => ({ ...current, field: value, difficulty: firstLevel?.difficulty || '' }));
      return;
    }
    setEditingPrice((current) => ({ ...current, [key]: value }));
  };

  const savePrice = async (event) => {
    event.preventDefault();
    if (!editingPrice) return;

    const price = Number(editingPrice.price);
    if (!editingPrice.difficulty || !Number.isFinite(price) || price < 0) {
      showToast('Hãy chọn độ khó và nhập giá tiền hợp lệ.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const payload = { field: editingPrice.field, difficulty: editingPrice.difficulty, price };
      if (editingPrice.id) {
        await api.updateDifficultyPrice(editingPrice.id, payload);
        showToast('Đã cập nhật giá tiền.', 'success');
      } else {
        await api.createDifficultyPrice(payload);
        showToast('Đã thêm giá tiền.', 'success');
      }
      setEditingPrice(null);
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể lưu giá tiền.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const removePrice = async (row) => {
    if (!row.priceRow || !window.confirm(`Xóa giá ${row.field} - ${row.difficulty}?`)) return;
    try {
      await api.deleteDifficultyPrice(row.priceRow.id);
      showToast('Đã xóa giá tiền.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể xóa giá tiền.', 'error');
    }
  };

  const openCreateLevel = () => {
    setEditingLevel({ id: null, field: levelManagerField, difficulty: '', color: DEFAULT_LEVEL_COLOR, textColor: DEFAULT_LEVEL_TEXT_COLOR });
  };

  const openEditLevel = (level) => {
    setEditingLevel({ id: level.id, field: level.field, difficulty: level.difficulty, color: level.color || DEFAULT_LEVEL_COLOR, textColor: level.textColor || DEFAULT_LEVEL_TEXT_COLOR });
  };

  const updateLevelField = (key, value) => {
    setEditingLevel((current) => ({ ...current, [key]: value }));
  };

  const saveLevel = async (event) => {
    event.preventDefault();
    if (!editingLevel?.difficulty.trim()) {
      showToast('Hãy nhập tên độ khó.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        field: editingLevel.field,
        difficulty: editingLevel.difficulty.trim(),
        color: editingLevel.color,
        textColor: editingLevel.textColor
      };
      if (editingLevel.id) {
        await api.updateDifficultyLevel(editingLevel.id, payload);
        showToast('Đã cập nhật độ khó.', 'success');
      } else {
        await api.createDifficultyLevel(payload);
        showToast('Đã thêm độ khó.', 'success');
      }
      setEditingLevel(null);
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể lưu độ khó.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const removeLevel = async (level) => {
    if (!window.confirm(`Xóa độ khó ${level.field} - ${level.difficulty}? Giá của độ khó này cũng sẽ bị xóa.`)) return;
    try {
      await api.deleteDifficultyLevel(level.id);
      showToast('Đã xóa độ khó và giá liên quan.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể xóa độ khó.', 'error');
    }
  };

  const updateBonusField = (key, value) => {
    setBonusDraft((current) => ({ ...(current ?? activeBonusConfig), [key]: value }));
  };

  const saveBonus = async (event) => {
    event.preventDefault();
    const taskThreshold = Number(activeBonusConfig.taskThreshold);
    const bonusPerTask = Number(activeBonusConfig.bonusPerTask);
    if (!Number.isInteger(taskThreshold) || taskThreshold < 0 || !Number.isFinite(bonusPerTask) || bonusPerTask < 0) {
      showToast('Hãy nhập x là số nguyên không âm và y là số tiền không âm.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await api.updateBonusSettings({ taskThreshold, bonusPerTask });
      setBonusDraft(null);
      showToast('Đã cập nhật cấu hình bonus.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể lưu cấu hình bonus.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">CẤU HÌNH</span>
          <h2 className="page-title">Giá tiền</h2>
          <p className="page-subtitle">Set độ khó và màu riêng cho từng mảng trước khi nhập giá.</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
            <IconRefresh size={16} /> Làm mới
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openCreatePrice()}>
            <IconPlus size={16} /> Nhập giá
          </button>
        </div>
      </div>

      <section className="glass-panel bonus-settings-panel">
        <div className="bonus-settings-header">
          <div>
            <span className="qc-kicker">BONUS FREELANCER</span>
            <h3>Thưởng theo task đạt 100%</h3>
            <p className="form-help">Nếu freelancer có hơn x task đạt 100%, mỗi task vượt ngưỡng sẽ được cộng y tiền.</p>
          </div>
        </div>
        <form className="bonus-settings-form" onSubmit={saveBonus}>
          <div className="form-group">
            <label className="form-label" htmlFor="bonus-task-threshold">Số task đạt 100% (x)</label>
            <input id="bonus-task-threshold" className="form-input" type="number" min="0" step="1" value={activeBonusConfig.taskThreshold} onChange={(event) => updateBonusField('taskThreshold', event.target.value)} disabled={isSaving} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="bonus-per-task">Bonus mỗi task vượt ngưỡng (y)</label>
            <input id="bonus-per-task" className="form-input" type="number" min="0" step="0.01" value={activeBonusConfig.bonusPerTask} onChange={(event) => updateBonusField('bonusPerTask', event.target.value)} disabled={isSaving} />
          </div>
          <div className="bonus-settings-actions">
            <span className="muted-inline">Ví dụ: x = 20, y = 10.000 ₫ thì task thứ 21 được cộng 10.000 ₫.</span>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu cấu hình bonus'}</button>
          </div>
        </form>
      </section>

      <section className="difficulty-field-grid">
        {fieldNames.map((fieldName) => {
          const levels = difficultyLevels.filter((level) => level.field === fieldName);
          return (
            <article className="glass-panel difficulty-field-card" key={fieldName}>
              <div className="difficulty-field-card-header">
                <div>
                  <span className="qc-kicker">MẢNG</span>
                  <h3>{fieldName}</h3>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLevelManagerField(fieldName)}>
                  <IconEdit size={14} /> Set độ khó
                </button>
              </div>
              <div className="difficulty-level-chips">
                {levels.length === 0 ? <span className="muted-inline">Chưa set độ khó</span> : levels.map((level) => (
                  <span className="difficulty-level-chip" key={level.id} style={{ backgroundColor: level.color || DEFAULT_LEVEL_COLOR, color: level.textColor || DEFAULT_LEVEL_TEXT_COLOR, borderColor: level.color || DEFAULT_LEVEL_COLOR }}>
                    {level.difficulty}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo mảng, độ khó hoặc giá" />
          </div>
          <select className="form-select toolbar-filter" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">Tất cả mảng</option>
            {fieldNames.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table price-table">
            <thead><tr><th>Mảng</th><th>Độ khó</th><th>Giá tiền</th><th>Thao tác</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="4"><div className="empty-state table-empty"><IconTasks size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có độ khó. Hãy bấm Set độ khó cho từng mảng.'}</strong></div></td></tr>
              ) : rows.map((row) => (
                <tr key={row.id || `${row.field}-${row.difficulty}`}>
                  <td><span className="field-badge">{row.field}</span></td>
                  <td><span className="difficulty-badge difficulty-custom-badge" style={{ '--difficulty-color': row.color || DEFAULT_LEVEL_COLOR, '--difficulty-text-color': row.textColor || DEFAULT_LEVEL_TEXT_COLOR }}>{row.difficulty}</span></td>
                  <td className="salary-cell">{row.priceRow ? formatPrice(row.priceRow.price) : <span className="muted-inline">Chưa nhập giá</span>}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditPrice(row)}>
                        <IconEdit size={14} /> {row.priceRow ? 'Sửa giá' : 'Nhập giá'}
                      </button>
                      {row.priceRow && <button type="button" className="btn btn-danger btn-sm" onClick={() => removePrice(row)}><IconTrash size={14} /> Xóa giá</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingPrice && (
        <div className="modal-overlay" onClick={() => !isSaving && setEditingPrice(null)}>
          <form className="modal-content price-edit-modal" onSubmit={savePrice} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="qc-kicker">GIÁ TIỀN</span><div className="modal-title">{editingPrice.id ? 'Chỉnh sửa giá' : 'Nhập giá'}</div></div>
              <button type="button" className="icon-button" onClick={() => setEditingPrice(null)} disabled={isSaving} title="Đóng"><IconX size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label" htmlFor="price-field">Mảng</label>
                <select id="price-field" className="form-select" value={editingPrice.field} onChange={(event) => updatePriceField('field', event.target.value)} disabled={isSaving}>
                  {fieldNames.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="price-difficulty">Độ khó đã set</label>
                <select id="price-difficulty" className="form-select" value={editingPrice.difficulty} onChange={(event) => updatePriceField('difficulty', event.target.value)} disabled={isSaving || levelsForPriceField.length === 0} required>
                  {levelsForPriceField.map((level) => <option key={level.id} value={level.difficulty}>{level.difficulty}</option>)}
                </select>
                {levelsForPriceField.length === 0 && <span className="form-help">Mảng này chưa có độ khó. Hãy đóng form và bấm Set độ khó.</span>}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="price-value">Giá tiền</label>
                <input id="price-value" className="form-input" type="number" min="0" step="0.01" value={editingPrice.price} onChange={(event) => updatePriceField('price', event.target.value)} disabled={isSaving} required />
              </div>
            </div>
            <div className="modal-footer"><button type="button" className="btn btn-outline" onClick={() => setEditingPrice(null)} disabled={isSaving}>Hủy</button><button type="submit" className="btn btn-primary" disabled={isSaving || levelsForPriceField.length === 0}>{isSaving ? 'Đang lưu...' : 'Lưu giá'}</button></div>
          </form>
        </div>
      )}

      {levelManagerField && (
        <div className="modal-overlay" onClick={() => !isSaving && setLevelManagerField(null)}>
          <div className="modal-content modal-lg difficulty-level-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="qc-kicker">SET ĐỘ KHÓ</span><div className="modal-title">{levelManagerField} — danh sách độ khó</div></div>
              <button type="button" className="icon-button" onClick={() => setLevelManagerField(null)} disabled={isSaving} title="Đóng"><IconX size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="difficulty-manager-toolbar"><span className="form-help">Tên và màu được lưu riêng cho mảng {levelManagerField}.</span><button type="button" className="btn btn-primary btn-sm" onClick={openCreateLevel} disabled={isSaving}><IconPlus size={14} /> Thêm độ khó</button></div>
              <div className="difficulty-level-manager-list">
                {difficultyLevels.filter((level) => level.field === levelManagerField).map((level) => (
                  <div className="difficulty-level-manager-row" key={level.id}>
                    <span className="difficulty-level-preview" style={{ backgroundColor: level.color || DEFAULT_LEVEL_COLOR, color: level.textColor || DEFAULT_LEVEL_TEXT_COLOR }}>{level.difficulty}</span>
                    <span className="difficulty-level-hex">Nền {level.color || DEFAULT_LEVEL_COLOR}</span>
                    <span className="difficulty-level-hex">Chữ {level.textColor || DEFAULT_LEVEL_TEXT_COLOR}</span>
                    <div className="table-actions"><button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditLevel(level)} disabled={isSaving}><IconEdit size={14} /> Sửa</button><button type="button" className="btn btn-danger btn-sm" onClick={() => removeLevel(level)} disabled={isSaving}><IconTrash size={14} /> Xóa</button></div>
                  </div>
                ))}
                {difficultyLevels.filter((level) => level.field === levelManagerField).length === 0 && <div className="empty-state table-empty"><IconTasks size={24} /><strong>Chưa có độ khó cho mảng này.</strong></div>}
              </div>
              {editingLevel && (
                <form className="difficulty-level-form" onSubmit={saveLevel}>
                  <div className="difficulty-level-form-heading">{editingLevel.id ? 'Chỉnh sửa độ khó' : 'Thêm độ khó'}</div>
                  <div className="difficulty-level-form-grid">
                    <div className="form-group"><label className="form-label" htmlFor="level-name">Tên độ khó</label><input id="level-name" className="form-input" value={editingLevel.difficulty} onChange={(event) => updateLevelField('difficulty', event.target.value)} maxLength="100" required disabled={isSaving} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="level-color">Màu nền</label><div className="color-input-row"><input id="level-color" className="color-input" type="color" value={editingLevel.color} onChange={(event) => updateLevelField('color', event.target.value)} disabled={isSaving} /><input className="form-input" value={editingLevel.color} onChange={(event) => updateLevelField('color', event.target.value)} maxLength="7" pattern="#[0-9A-Fa-f]{6}" required disabled={isSaving} /></div></div>
                    <div className="form-group"><label className="form-label" htmlFor="level-text-color">Màu chữ</label><div className="color-input-row"><input id="level-text-color" className="color-input" type="color" value={editingLevel.textColor} onChange={(event) => updateLevelField('textColor', event.target.value)} disabled={isSaving} /><input className="form-input" value={editingLevel.textColor} onChange={(event) => updateLevelField('textColor', event.target.value)} maxLength="7" pattern="#[0-9A-Fa-f]{6}" required disabled={isSaving} /></div></div>
                  </div>
                  <div className="modal-inline-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingLevel(null)} disabled={isSaving}>Hủy</button><button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu độ khó'}</button></div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function priceKey(field, difficulty) {
  return `${field}::${difficulty}`;
}

function formatPrice(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toLocaleString('vi-VN')} ₫` : '—';
}
