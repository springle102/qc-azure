import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  deleteRowById,
  deleteRowsByKeys,
  getDataSource,
  insertRow,
  isDatabaseConfigured,
  selectRows,
  updateRow,
  updateRowById
} from './supabaseRepository.js';

const app = express();
const PORT = process.env.PORT || 5000;
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const emptyCollections = {
  tasks: [],
  freelancers: [],
  qcs: [],
  accounts: [],
  deadlines: [],
  difficultyLevels: [],
  difficultyPricing: [],
  bonusSettings: [],
  fields: [],
  generalSettings: []
};

async function getCollection(collection) {
  if (!isDatabaseConfigured()) return emptyCollections[collection];
  const rows = await selectRows(collection);
  return rows;
}

async function sendCollection(collection, req, res) {
  try {
    const rows = filterRowsForUser(await getCollection(collection), req.authUser);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Webtoon Deadline Management API',
    dataSource: getDataSource()
  });
});

app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
  try {
    await syncGoogleSheetIfDue();
    const [tasks, deadlines] = await Promise.all([
      getCollection('tasks'),
      getCollection('deadlines')
    ]);
    const scopedTasks = filterRowsForUser(tasks, req.authUser);
    const scopedDeadlines = filterRowsForUser(deadlines, req.authUser);
    const trackedTasks = scopedDeadlines.length > 0 ? scopedDeadlines : scopedTasks;
    const upcomingTasks = trackedTasks
      .filter((task) => isTaskDueSoon(task))
      .sort((left, right) => getTaskDueTime(left) - getTaskDueTime(right));
    const fieldResources = (await getVisibleFields(req.authUser)).map((field) => ({
      field: field.name,
      guideUrl: field.guideUrl || '',
      resourceUrl: field.resourceUrl || ''
    }));
    const legacyLinks = req.authUser.role === 'Freelancer'
      ? { guideUrl: fieldResources[0]?.guideUrl || '', resourceUrl: fieldResources[0]?.resourceUrl || '' }
      : { guideUrl: process.env.GUIDE_URL || '', resourceUrl: process.env.RESOURCE_URL || '' };
    const completed = scopedTasks.filter((item) => isTaskComplete(item)).length;
    const assigned = scopedTasks.filter((item) => item.fId || item.fIld || item.freelancerId || item.assignedToId || item.assignedTo).length;
    const review = scopedTasks.filter((item) => /qc|review|duyệt|kiểm/i.test(item.status || item.statusRaw || '')).length;

    res.json({
      success: true,
      data: {
        guideUrl: legacyLinks.guideUrl,
        resourceUrl: legacyLinks.resourceUrl,
        fieldResources,
        waitingTasks: Math.max(0, scopedTasks.length - assigned),
        assignedTasks: assigned,
        reviewTasks: review,
        completedTasks: completed,
        inProgressTasks: trackedTasks.filter((item) => getTaskStatus(item) === 'doing').length,
        upcomingTasks: req.authUser.role === 'Freelancer' ? upcomingTasks : []
      }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    await syncGoogleSheetIfDue();
    return sendCollection('tasks', req, res);
  } catch (error) {
    return res.status(502).json({ success: false, message: error.message });
  }
});
app.get('/api/freelancers', requireAuth, async (req, res) => {
  try {
    const [freelancers, accounts] = await Promise.all([
      getCollection('freelancers'),
      getCollection('accounts')
    ]);
    const scopedFreelancers = filterRowsForUser(freelancers, req.authUser);
    const data = scopedFreelancers.map((freelancer) => {
      const freelancerId = freelancer.fIld ?? freelancer.fId ?? freelancer.id;
      const account = accounts.find((item) => String(item.freelancerId ?? '') === String(freelancerId));
      return {
        ...freelancer,
        accountId: account?.id ?? null,
        accountUsername: account?.username ?? null,
        accountRole: account?.role ?? null,
        accountIsActive: account ? account.isActive !== false : null
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.patch('/api/freelancers/:id', requireManager, async (req, res) => {
  const freelancerId = Number(req.params.id);
  if (!Number.isInteger(freelancerId)) return res.status(400).json({ success: false, message: 'ID freelancer không hợp lệ.' });

  try {
    const freelancers = await getCollection('freelancers');
    const current = freelancers.find((freelancer) => Number(freelancer.fIld ?? freelancer.fId ?? freelancer.id) === freelancerId);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy freelancer cần cập nhật.' });

    const updates = validateFreelancerUpdatePayload(req.body);
    if (updates.field) await assertConfiguredFields([updates.field]);
    const data = await updateRow('freelancers', { fIld: freelancerId }, updates, ['name', 'email', 'field', 'note']);
    const accounts = await getCollection('accounts');
    const linkedAccount = accounts.find((account) => String(account.freelancerId ?? '') === String(freelancerId));
    if (linkedAccount) {
      await updateRowById(
        'accounts',
        linkedAccount.id,
        { displayName: data.name, email: data.email || null, field: data.field || null },
        ['displayName', 'email', 'field']
      );
      invalidateAccountSessions(linkedAccount.id);
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/qcs', requireAuth, async (req, res) => {
  try {
    const [qcs, accounts] = await Promise.all([
      getCollection('qcs'),
      getCollection('accounts')
    ]);
    const accountQcs = accounts
      .filter((account) => account.role === 'QC')
      .map((account) => ({
        qcId: account.id,
        name: account.displayName || account.username,
        email: account.email || null,
        imageQR: null
      }));
    const merged = [...qcs, ...accountQcs].reduce((rows, row) => {
      const id = row.qcId ?? row.id;
      const existingIndex = rows.findIndex((item) => String(item.qcId ?? item.id) === String(id));
      if (existingIndex === -1) rows.push({ ...row, qcId: id });
      else rows[existingIndex] = { ...rows[existingIndex], ...row, qcId: id };
      return rows;
    }, []);
    res.json({ success: true, data: merged });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/fields', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await getVisibleFields(req.authUser) });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.post('/api/fields', requireAdmin, async (req, res) => {
  try {
    const name = validateConfiguredFieldPayload(req.body);
    const fields = await getConfiguredFields();
    if (fields.some((field) => field.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ success: false, message: 'Mảng này đã tồn tại.' });
    }
    const data = await insertRow('fields', { name, guideUrl: null, resourceUrl: null }, ['name', 'guideUrl', 'resourceUrl']);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});
app.patch('/api/fields/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID mảng không hợp lệ.' });

  try {
    const fields = await getConfiguredFields();
    const current = fields.find((field) => Number(field.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy mảng cần cập nhật.' });
    const name = validateConfiguredFieldPayload(req.body);
    const updates = { name };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'guideUrl')) {
      updates.guideUrl = normalizeOptionalUrl(req.body.guideUrl, 'Guide URL');
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'resourceUrl')) {
      updates.resourceUrl = normalizeOptionalUrl(req.body.resourceUrl, 'Tài nguyên URL');
    }
    if (fields.some((field) => Number(field.id) !== id && field.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ success: false, message: 'Mảng này đã tồn tại.' });
    }
    await renameConfiguredField(current.name, name);
    const data = await updateRowById('fields', id, updates, ['name', 'guideUrl', 'resourceUrl']);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});
app.delete('/api/fields/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID mảng không hợp lệ.' });

  try {
    const fields = await getConfiguredFields();
    const current = fields.find((field) => Number(field.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy mảng cần xóa.' });
    if (fields.length <= 1) return res.status(400).json({ success: false, message: 'Phải giữ lại ít nhất một mảng.' });
    if (await isConfiguredFieldInUse(current.name)) {
      return res.status(409).json({ success: false, message: 'Không thể xóa mảng đang được sử dụng.' });
    }
    const data = await deleteRowById('fields', id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/accounts', requireAdmin, async (req, res) => {
  try {
    const [accounts, freelancers] = await Promise.all([
      getCollection('accounts'),
      getCollection('freelancers')
    ]);
    res.json({ success: true, data: accounts.map((account) => toPublicAccount(account, freelancers)) });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.post('/api/accounts', requireAdmin, async (req, res) => {
  try {
    const payload = validateAccountPayload(req.body);
    await assertConfiguredFields(payload.fields);
    if (['Freelancer', 'QC'].includes(payload.role) && payload.freelancerId === null) {
      payload.freelancerId = await ensureFreelancerForAccount(payload);
    }
    await assertFreelancerExists(payload.freelancerId, payload.role);
    await assertFreelancerAccountAvailable(payload.freelancerId);
    const { hash, salt } = hashPassword(payload.password);
    const data = await insertRow(
      'accounts',
      {
        username: payload.username,
        passwordHash: hash,
        passwordSalt: salt,
        role: payload.role,
        displayName: payload.displayName,
        email: payload.email,
        field: payload.field,
        fields: payload.fields,
        freelancerId: payload.freelancerId,
        isActive: true
      },
      ['username', 'passwordHash', 'passwordSalt', 'role', 'displayName', 'email', 'field', 'fields', 'freelancerId', 'isActive']
    );
    await syncFreelancerFromAccount(data);
    res.status(201).json({ success: true, data: toPublicAccount(data, await getCollection('freelancers')) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.code === '23505' ? 'Username đã tồn tại.' : error.message });
  }
});
app.patch('/api/accounts/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID account không hợp lệ.' });

  try {
    const accounts = await getCollection('accounts');
    const current = accounts.find((account) => Number(account.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy account cần cập nhật.' });

    const payload = validateAccountUpdatePayload(req.body, current);
    await assertConfiguredFields(payload.fields);
    if (['Freelancer', 'QC'].includes(payload.role) && payload.freelancerId === null) {
      payload.freelancerId = await ensureFreelancerForAccount({ ...current, ...payload });
    }
    await assertFreelancerExists(payload.freelancerId, payload.role);
    await assertFreelancerAccountAvailable(payload.freelancerId, id);
    const updates = { ...payload };
    if (updates.password) {
      const { hash, salt } = hashPassword(updates.password);
      updates.passwordHash = hash;
      updates.passwordSalt = salt;
    }
    delete updates.password;

    const data = await updateRowById(
      'accounts',
      id,
      updates,
      ['username', 'passwordHash', 'passwordSalt', 'role', 'displayName', 'email', 'field', 'fields', 'freelancerId', 'isActive']
    );
    await syncFreelancerFromAccount(data);
    invalidateAccountSessions(id);
    res.json({ success: true, data: toPublicAccount(data, await getCollection('freelancers')) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.code === '23505' ? 'Username đã tồn tại.' : error.message });
  }
});
app.get('/api/deadlines', requireAuth, async (req, res) => {
  try {
    await syncGoogleSheetIfDue();
    const deadlines = filterRowsForUser(await getCollection('deadlines'), req.authUser);
    const prices = await getCollection('difficultyPricing');
    res.json({ success: true, data: applyConfiguredPrices(deadlines, prices) });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.get('/api/difficulty-levels', requireAuth, (req, res) => sendCollection('difficultyLevels', req, res));
app.get('/api/difficulty-prices', requireAuth, (req, res) => sendCollection('difficultyPricing', req, res));
app.get('/api/bonus-settings', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await getBonusSettings() });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.get('/api/general-settings', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await getGeneralSettings() });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.patch('/api/general-settings', requireAdmin, async (req, res) => {
  try {
    const current = (await getCollection('generalSettings'))[0];
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetUrl')) {
      updates.googleSheetUrl = normalizeGoogleSheetUrl(req.body.googleSheetUrl);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetRange')) {
      updates.googleSheetRange = nullableText(req.body.googleSheetRange);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetTabs')) {
      updates.googleSheetTabs = JSON.stringify(normalizeGoogleSheetTabs(req.body.googleSheetTabs));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetAutoSync')) {
      updates.googleSheetAutoSync = req.body.googleSheetAutoSync === true;
    }
    const data = current
      ? await updateRow('generalSettings', { id: current.id }, updates, ['googleSheetUrl', 'googleSheetRange', 'googleSheetTabs', 'googleSheetAutoSync'])
      : await insertRow('generalSettings', { id: 1, ...updates }, ['id', 'googleSheetUrl', 'googleSheetRange', 'googleSheetTabs', 'googleSheetAutoSync']);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.post('/api/google-sheet/sync', requireAdmin, async (req, res) => {
  try {
    const result = await syncGoogleSheet();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/salaries', requireAuth, async (req, res) => {
  try {
    await syncGoogleSheetIfDue();
    const [freelancers, deadlines, prices, bonusSettings] = await Promise.all([
      getCollection('freelancers'),
      getCollection('deadlines'),
      getCollection('difficultyPricing'),
      getBonusSettings()
    ]);
    const scopedFreelancers = filterSalaryRowsForUser(freelancers, req.authUser);
    const scopedDeadlines = filterSalaryRowsForUser(deadlines, req.authUser);
    res.json({
      success: true,
      data: buildSalaryRows(scopedFreelancers, applyConfiguredPrices(scopedDeadlines, prices), bonusSettings)
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.post('/api/deadlines', requireManager, async (req, res) => {
  try {
    const payload = validateDeadlineCreatePayload(req.body);
    await assertConfiguredFields([payload.type]);
    if (payload.status === 'doing') payload.doingStartedAt = new Date().toISOString();
    const prices = await selectRows('difficultyPricing');
    const configuredPrice = prices.find((item) => item.field === payload.type && item.difficulty === payload.difficulty);
    if (!configuredPrice) {
      return res.status(400).json({ success: false, message: 'Chưa có giá tiền cho mảng và độ khó đã chọn.' });
    }

    payload.price = configuredPrice.price;
    payload.receivePrice = calculateReceivePrice(payload.price, payload.completionPercent);
    const data = await insertRow(
      'deadlines',
      payload,
      ['seriesId', 'chapterNumber', 'endTask', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status', 'doingStartedAt', 'workDurationSeconds', 'urlSeries', 'fIld', 'qcId', 'difficulty', 'price', 'receivePrice', 'feedback', 'completionPercent']
    );
    res.status(201).json({ success: true, data: decorateDeadlineTiming(data) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});

app.patch('/api/deadlines/:seriesId/:chapterNumber/status', requireAuth, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const chapterNumber = Number(req.params.chapterNumber);
  if (!Number.isInteger(seriesId) || !Number.isInteger(chapterNumber)) {
    return res.status(400).json({ success: false, message: 'seriesId và chapterNumber phải là số nguyên.' });
  }

  try {
    const currentRows = await selectRows('deadlines');
    const current = currentRows.find((item) => Number(item.seriesId) === seriesId && Number(item.chapterNumber) === chapterNumber);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy deadline cần cập nhật.' });
    if (req.authUser.role === 'Freelancer' && String(current.fIld ?? '') !== String(req.authUser.freelancerId ?? '')) {
      return res.status(403).json({ success: false, message: 'Freelancer chỉ được cập nhật task của mình.' });
    }
    const status = validateTaskStatus(req.body?.status);
    if (req.authUser.role === 'Freelancer' && !['doing', 'submitted'].includes(status)) {
      return res.status(403).json({ success: false, message: 'Freelancer chỉ được chọn Doing hoặc Submitted.' });
    }
    const updates = buildStatusTransition(current, status);
    const data = await updateRow(
      'deadlines',
      { seriesId, chapterNumber },
      updates,
      ['status', 'doingStartedAt', 'workDurationSeconds', 'submittedAt']
    );
    res.json({ success: true, data: decorateDeadlineTiming(data) });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.patch('/api/deadlines/:seriesId/:chapterNumber', requireManager, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const chapterNumber = Number(req.params.chapterNumber);
  if (!Number.isInteger(seriesId) || !Number.isInteger(chapterNumber)) {
    return res.status(400).json({ success: false, message: 'seriesId và chapterNumber phải là số nguyên.' });
  }

  try {
    const currentRows = await selectRows('deadlines');
    const current = currentRows.find((item) => Number(item.seriesId) === seriesId && Number(item.chapterNumber) === chapterNumber);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy deadline cần cập nhật.' });

    const updates = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
      updates.status = validateTaskStatus(updates.status);
      Object.assign(updates, buildStatusTransition(current, updates.status));
    }
    const needsReprice = Object.prototype.hasOwnProperty.call(updates, 'difficulty')
      || Object.prototype.hasOwnProperty.call(updates, 'type');
    const nextField = updates.type ?? current.type;
    const nextDifficulty = updates.difficulty ?? current.difficulty;
    if (Object.prototype.hasOwnProperty.call(updates, 'type')) await assertConfiguredFields([nextField]);
    const prices = await selectRows('difficultyPricing');
    const configuredPrice = prices.find((item) => item.field === nextField && item.difficulty === nextDifficulty);
    if (configuredPrice) {
      updates.price = configuredPrice.price;
    } else if (needsReprice) {
      return res.status(400).json({ success: false, message: 'Chưa có giá tiền cho mảng và độ khó đã chọn.' });
    } else {
      delete updates.price;
    }

    const nextPrice = updates.price ?? current.price;
    const nextCompletionPercent = updates.completionPercent ?? current.completionPercent ?? 100;
    const calculatedReceivePrice = calculateReceivePrice(nextPrice, nextCompletionPercent);
    if (calculatedReceivePrice === null) {
      delete updates.receivePrice;
    } else {
      updates.receivePrice = calculatedReceivePrice;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'completionPercent')) {
      if (updates.completionPercent === null || updates.completionPercent === '') {
        return res.status(400).json({ success: false, message: '% hoàn thành không được để trống.' });
      }
      const completionPercent = Number(updates.completionPercent);
      if (!Number.isInteger(completionPercent) || completionPercent < 0 || completionPercent > 200) {
        return res.status(400).json({ success: false, message: '% hoàn thành phải là số nguyên từ 0 đến 200.' });
      }
    }

    const data = await updateRow(
      'deadlines',
      { seriesId, chapterNumber },
      updates,
      ['endTask', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status', 'doingStartedAt', 'workDurationSeconds', 'urlSeries', 'fIld', 'qcId', 'difficulty', 'price', 'receivePrice', 'feedback', 'completionPercent']
    );
    res.json({ success: true, data: decorateDeadlineTiming(data) });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

const DEFAULT_FIELDS = ['Japan', 'Latin', 'QC'];
const difficultyLevelFields = ['field', 'difficulty', 'color'];
const pricingFields = ['field', 'difficulty', 'price'];
const bonusSettingsFields = ['taskThreshold', 'bonusPerTask'];

app.post('/api/difficulty-levels', requireManager, async (req, res) => {
  try {
    const payload = validateDifficultyLevelPayload(req.body);
    await assertConfiguredFields([payload.field]);
    const data = await insertRow('difficultyLevels', payload, difficultyLevelFields);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});

app.patch('/api/difficulty-levels/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID độ khó không hợp lệ.' });

  try {
    const levels = await selectRows('difficultyLevels');
    const current = levels.find((item) => Number(item.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy độ khó cần cập nhật.' });

    const payload = validateDifficultyLevelPayload(req.body, true);
    const nextField = payload.field || current.field;
    const nextDifficulty = payload.difficulty || current.difficulty;
    await assertConfiguredFields([nextField]);
    if (nextField !== current.field || nextDifficulty !== current.difficulty) {
      const prices = await selectRows('difficultyPricing');
      const hasPrice = prices.some((item) => item.field === current.field && item.difficulty === current.difficulty);
      if (hasPrice) {
        await updateRow(
          'difficultyPricing',
          { field: current.field, difficulty: current.difficulty },
          { field: nextField, difficulty: nextDifficulty },
          pricingFields
        );
      }
    }

    const data = await updateRowById('difficultyLevels', id, payload, difficultyLevelFields);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});

app.delete('/api/difficulty-levels/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID độ khó không hợp lệ.' });

  try {
    const levels = await selectRows('difficultyLevels');
    const current = levels.find((item) => Number(item.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy độ khó cần xóa.' });

    await deleteRowsByKeys('difficultyPricing', { field: current.field, difficulty: current.difficulty });
    const data = await deleteRowById('difficultyLevels', id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.post('/api/difficulty-prices', requireManager, async (req, res) => {
  try {
    const payload = validatePricingPayload(req.body);
    await assertConfiguredFields([payload.field]);
    await assertDifficultyLevelExists(payload.field, payload.difficulty);
    const data = await insertRow('difficultyPricing', payload, pricingFields);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});

app.patch('/api/difficulty-prices/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID mức giá không hợp lệ.' });

  try {
    const payload = validatePricingPayload(req.body, true);
    const currentPrices = await selectRows('difficultyPricing');
    const current = currentPrices.find((item) => Number(item.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy mức giá cần cập nhật.' });
    await assertConfiguredFields([payload.field || current.field]);
    await assertDifficultyLevelExists(payload.field || current.field, payload.difficulty || current.difficulty);
    const data = await updateRowById('difficultyPricing', id, payload, pricingFields);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});

app.delete('/api/difficulty-prices/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID mức giá không hợp lệ.' });

  try {
    const data = await deleteRowById('difficultyPricing', id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.patch('/api/bonus-settings', requireManager, async (req, res) => {
  try {
    const payload = validateBonusSettingsPayload(req.body);
    const currentRows = await selectRows('bonusSettings');
    const data = currentRows[0]
      ? await updateRow('bonusSettings', { id: currentRows[0].id }, payload, bonusSettingsFields)
      : await insertRow('bonusSettings', { id: 1, ...payload }, ['id', ...bonusSettingsFields]);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.patch('/api/profile', requireAuth, async (req, res) => {
  try {
    const accounts = await getCollection('accounts');
    const currentAccount = accounts.find((account) => String(account.id) === String(req.authUser.id));
    if (!currentAccount) return res.status(404).json({ success: false, message: 'Không tìm thấy account hiện tại.' });

    const accountUpdates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const displayName = String(req.body.name ?? '').trim();
      if (!displayName || displayName.length > 150) throw validationError('Họ và tên không được để trống và tối đa 150 ký tự.');
      accountUpdates.displayName = displayName;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
      const email = String(req.body.email ?? '').trim() || null;
      if (email && email.length > 255) throw validationError('Email không hợp lệ.');
      accountUpdates.email = email;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
      const password = String(req.body.password ?? '');
      if (password.length < 6) throw validationError('Password phải có ít nhất 6 ký tự.');
      const { hash, salt } = hashPassword(password);
      accountUpdates.passwordHash = hash;
      accountUpdates.passwordSalt = salt;
    }

    const account = Object.keys(accountUpdates).length > 0
      ? await updateRowById('accounts', currentAccount.id, accountUpdates, ['displayName', 'email', 'passwordHash', 'passwordSalt'])
      : currentAccount;
    if (Object.keys(accountUpdates).some((key) => ['displayName', 'email'].includes(key))) {
      await syncFreelancerFromAccount(account);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'imageQR')) {
      const freelancerId = account.freelancerId ?? req.authUser.freelancerId;
      if (freelancerId === null || freelancerId === undefined || freelancerId === '') {
        throw validationError('Account hiện tại chưa được liên kết với hồ sơ freelancer.');
      }
      const imageQR = normalizeImageDataUrl(req.body.imageQR);
      await updateRow('freelancers', { fIld: freelancerId }, { imageQR }, ['imageQR']);
    }

    const linkedFreelancers = await getCollection('freelancers');
    const publicUser = toPublicAccount(account, linkedFreelancers);
    const token = getBearerToken(req);
    const session = token ? sessions.get(token) : null;
    if (session) session.user = publicUser;
    res.json({ success: true, data: publicUser });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const accounts = await getCollection('accounts');
    const account = accounts.find((item) => String(item.username).toLowerCase() === username && item.isActive !== false);
    if (!account || !verifyPassword(password, account.passwordHash, account.passwordSalt)) {
      return res.status(401).json({ success: false, message: 'Username hoặc password không đúng.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user: toPublicAccount(account), expiresAt: Date.now() + SESSION_TTL_MS });
    res.json({ success: true, data: { token, user: toPublicAccount(account) } });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, data: req.authUser });
});

app.post('/api/auth/logout', (req, res) => {
  const token = getBearerToken(req);
  if (token) sessions.delete(token);
  res.json({ success: true, data: true });
});

app.listen(PORT, () => {
  console.log(`Webtoon Deadline Management API listening on port ${PORT}`);
});

function applyConfiguredPrices(deadlines, prices) {
  return deadlines.map((deadline) => {
    const configuredPrice = prices.find((item) => item.field === deadline.type && item.difficulty === deadline.difficulty);
    const price = configuredPrice?.price ?? deadline.price;
    const receivePrice = calculateReceivePrice(price, deadline.completionPercent ?? 100);
    const updated = receivePrice === null
      ? (configuredPrice ? { ...deadline, price } : deadline)
      : { ...deadline, price, receivePrice };
    return decorateDeadlineTiming(updated);
  });
}

async function getConfiguredFields() {
  const rows = await getCollection('fields');
  if (rows.length > 0) return rows.sort((left, right) => Number(left.id) - Number(right.id));
  return DEFAULT_FIELDS.map((name, index) => ({ id: index + 1, name, guideUrl: '', resourceUrl: '' }));
}

async function getVisibleFields(user) {
  const fields = await getConfiguredFields();
  if (user?.role !== 'Freelancer') return fields;

  const allowedFields = normalizeStoredFields(user.fields, user.field).map((field) => field.toLowerCase());
  return fields.filter((field) => allowedFields.includes(String(field.name || '').toLowerCase()));
}

async function assertConfiguredFields(names) {
  const configured = await getConfiguredFields();
  const configuredNames = new Set(configured.map((field) => field.name));
  for (const name of names.filter(Boolean)) {
    if (!configuredNames.has(name)) throw validationError(`Mảng ${name} chưa được cấu hình.`);
  }
}

function validateConfiguredFieldPayload(payload) {
  return normalizeConfiguredFieldName(payload?.name);
}

function normalizeConfiguredFieldName(value) {
  const name = String(value ?? '').trim();
  if (!isValidConfiguredFieldName(name)) throw validationError('Tên mảng phải có từ 1 đến 50 ký tự hợp lệ.');
  return name;
}

function normalizeOptionalUrl(value, label) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;

  try {
    const parsed = new URL(rawValue);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw validationError(`${label} phải là URL http hoặc https hợp lệ.`);
  }
  return rawValue;
}

function normalizeImageDataUrl(value) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;
  if (rawValue.length > 4 * 1024 * 1024 || !/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(rawValue)) {
    throw validationError('Mã QR phải là ảnh PNG, JPG, WEBP hoặc GIF hợp lệ và không quá 3 MB.');
  }
  return rawValue;
}

function isValidConfiguredFieldName(value) {
  return /^[\p{L}][\p{L}\p{N} _-]{0,49}$/u.test(String(value ?? '').trim());
}

async function isConfiguredFieldInUse(name) {
  const [levels, prices, accounts, freelancers, deadlines] = await Promise.all([
    getCollection('difficultyLevels'),
    getCollection('difficultyPricing'),
    getCollection('accounts'),
    getCollection('freelancers'),
    getCollection('deadlines')
  ]);
  return levels.some((row) => row.field === name)
    || prices.some((row) => row.field === name)
    || accounts.some((row) => row.field === name || normalizeStoredFields(row.fields, row.field).includes(name))
    || freelancers.some((row) => row.field === name || normalizeStoredFields(row.fields, row.field).includes(name))
    || deadlines.some((row) => row.type === name);
}

async function renameConfiguredField(previousName, nextName) {
  const [levels, prices, accounts, freelancers, deadlines] = await Promise.all([
    getCollection('difficultyLevels'),
    getCollection('difficultyPricing'),
    getCollection('accounts'),
    getCollection('freelancers'),
    getCollection('deadlines')
  ]);
  await Promise.all(levels.filter((row) => row.field === previousName).map((row) => updateRowById('difficultyLevels', row.id, { field: nextName }, ['field'])));
  await Promise.all(prices.filter((row) => row.field === previousName).map((row) => updateRowById('difficultyPricing', row.id, { field: nextName }, ['field'])));
  await Promise.all(accounts.filter((row) => row.field === previousName || normalizeStoredFields(row.fields, row.field).includes(previousName)).map((row) => {
    const fields = normalizeStoredFields(row.fields, row.field).map((field) => field === previousName ? nextName : field);
    return updateRowById('accounts', row.id, { field: fields[0] || null, fields }, ['field', 'fields']);
  }));
  await Promise.all(freelancers.filter((row) => row.field === previousName || normalizeStoredFields(row.fields, row.field).includes(previousName)).map((row) => {
    const fields = normalizeStoredFields(row.fields, row.field).map((field) => field === previousName ? nextName : field);
    return updateRow('freelancers', { fIld: row.fIld }, { field: fields[0] || null, fields }, ['field', 'fields']);
  }));
  await Promise.all(deadlines.filter((row) => row.type === previousName).map((row) => updateRow('deadlines', { seriesId: row.seriesId, chapterNumber: row.chapterNumber }, { type: nextName }, ['type'])));
}

async function getGeneralSettings() {
  const rows = await getCollection('generalSettings');
  if (rows[0]) {
    const { deadlineHours: _legacyDeadlineHours, ...settings } = rows[0];
    return { ...settings, googleSheetTabs: parseGoogleSheetTabs(settings.googleSheetTabs) };
  }
  return {
    id: 1,
    googleSheetUrl: '',
    googleSheetRange: '',
    googleSheetTabs: {},
    googleSheetAutoSync: false,
    googleSheetLastSyncedAt: null,
    googleSheetLastSyncCount: 0,
    googleSheetLastSyncError: ''
  };
}

let googleAccessTokenCache = null;
let googleSheetSyncPromise = null;

function normalizeGoogleSheetUrl(value) {
  const urlText = nullableText(value);
  if (!urlText) return '';

  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    throw validationError('Link Google Sheet không hợp lệ.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!['docs.google.com', 'sheets.google.com'].includes(hostname) || !parsed.pathname.includes('/spreadsheets/d/')) {
    throw validationError('Link phải là Google Sheet dạng docs.google.com/spreadsheets/d/...');
  }
  return parsed.toString();
}

function parseGoogleSheetTabs(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeGoogleSheetTabs(value) {
  return Object.fromEntries(Object.entries(parseGoogleSheetTabs(value))
    .map(([field, tab]) => [String(field).trim(), String(tab ?? '').trim()])
    .filter(([field, tab]) => field && tab));
}

function readGoogleServiceAccount() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const raw = inlineJson
    || (base64Json ? Buffer.from(base64Json, 'base64').toString('utf8') : '')
    || (filePath ? readFileSync(filePath, 'utf8') : '');

  if (!raw) {
    throw new Error('Chưa cấu hình Google Service Account. Hãy đặt GOOGLE_SERVICE_ACCOUNT_JSON hoặc GOOGLE_SERVICE_ACCOUNT_FILE trong apps/server/.env.');
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ.');
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google Service Account thiếu client_email hoặc private_key.');
  }
  return credentials;
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function getGoogleAccessToken() {
  if (googleAccessTokenCache && googleAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return googleAccessTokenCache.token;
  }

  const credentials = readGoogleServiceAccount();
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = encodeBase64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600
  }));
  const unsignedToken = `${header}.${claimSet}`;
  const signature = crypto.createSign('RSA-SHA256')
    .update(unsignedToken)
    .end()
    .sign(String(credentials.private_key).replace(/\\n/g, '\n'), 'base64url');
  const assertion = `${unsignedToken}.${signature}`;
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    });
  } catch {
    throw new Error('Không thể kết nối Google OAuth. Hãy kiểm tra Internet của máy chạy backend.');
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Google OAuth không cấp được access token: ${message}`);
  }

  const payload = await response.json();
  googleAccessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
  };
  return googleAccessTokenCache.token;
}

async function googleSheetsRequest(path) {
  const token = await getGoogleAccessToken();
  let response;
  try {
    response = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    throw new Error('Không thể kết nối Google Sheets API. Hãy kiểm tra Internet của máy chạy backend.');
  }
  if (!response.ok) {
    const message = await response.text();
    if (response.status === 403 && /SERVICE_DISABLED|has not been used in project|Sheets API/i.test(message)) {
      throw new Error('Google Sheets API đang bị tắt. Hãy bật Google Sheets API trong Google Cloud project rồi thử lại sau vài phút.');
    }
    if (response.status === 403 && /permission|not have access|does not have permission/i.test(message)) {
      throw new Error('Service Account chưa được cấp quyền Viewer trên Google Sheet. Hãy chia sẻ file cho email client_email trong file JSON.');
    }
    throw new Error(`Google Sheets API trả về lỗi ${response.status}: ${message}`);
  }
  return response.json();
}

function parseGoogleSheetReference(sheetUrl) {
  const parsed = new URL(sheetUrl);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw validationError('Không tìm thấy Spreadsheet ID trong link Google Sheet.');
  return {
    spreadsheetId: decodeURIComponent(match[1]),
    gid: parsed.searchParams.get('gid')
  };
}

async function getGoogleSheetMetadata(spreadsheetId) {
  return googleSheetsRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`
  );
}

function resolveGoogleSheetRange(tabReference, sheets) {
  const reference = String(tabReference ?? '').trim();
  if (!reference) return null;
  const bangIndex = reference.indexOf('!');
  const sheetTitle = bangIndex === -1 ? reference : reference.slice(0, bangIndex);
  const selectedSheet = sheets.find((sheet) => String(sheet.properties?.title).toLowerCase() === sheetTitle.toLowerCase());
  if (!selectedSheet) throw new Error(`Không tìm thấy tab "${sheetTitle}" trong Google Sheet.`);
  return bangIndex === -1 ? `${selectedSheet.properties.title}!A:ZZ` : reference;
}

async function readGoogleSheetValues(spreadsheetId, range) {
  const query = new URLSearchParams({ majorDimension: 'ROWS' });
  const payload = await googleSheetsRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${query.toString()}`
  );
  return payload.values || [];
}

async function readGoogleSheetTabs(settings) {
  const { spreadsheetId, gid } = parseGoogleSheetReference(settings.googleSheetUrl);
  const metadata = await getGoogleSheetMetadata(spreadsheetId);
  const sheets = metadata.sheets || [];
  const configuredTabs = Object.entries(normalizeGoogleSheetTabs(settings.googleSheetTabs));
  if (configuredTabs.length > 0) {
    return Promise.all(configuredTabs.map(async ([field, tabReference]) => {
      const range = resolveGoogleSheetRange(tabReference, sheets);
      return { field, range, values: await readGoogleSheetValues(spreadsheetId, range) };
    }));
  }

  const selectedSheet = gid
    ? sheets.find((sheet) => String(sheet.properties?.sheetId) === String(gid))
    : sheets[0];
  const range = settings.googleSheetRange || selectedSheet?.properties?.title;
  if (!range) throw new Error('Không tìm thấy tab trong Google Sheet.');
  const resolvedRange = range.includes('!') ? range : resolveGoogleSheetRange(range, sheets);
  return [{ field: null, range: resolvedRange, values: await readGoogleSheetValues(spreadsheetId, resolvedRange) }];
}

function normalizeSheetHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const googleSheetHeaderAliases = {
  seriesId: ['seriesid', 'series', 'seriescode', 'maseries', 'mabtruyen', 'geid', 'azid'],
  chapterNumber: ['chapternumber', 'chapter', 'chap', 'chapterno', 'sochapter', 'chuong'],
  seriesName: ['seriesname', 'tensries', 'tentruyen', 'tentruyen', 'krtitle'],
  type: ['type', 'field', 'mang', 'theloai', 'lang'],
  endTask: ['endtask', 'end', 'deadline', 'due', 'duedate', 'han', 'thoigianketthuc', 'dl'],
  submittedAt: ['submittedat', 'submittedon', 'ngaynop', 'ngaynopbai', 'datesubmitted'],
  statusRaw: ['statusraw', 'rawstatus', 'trangthairaw', 'trangthai'],
  status: ['status', 'taskstatus', 'trangthaicodinh'],
  urlSeries: ['urlseries', 'seriesurl', 'url', 'link', 'linktruyen', 'file'],
  fIld: ['fild', 'freelancerid', 'freelancer', 'freelancername', 'nguoiduocgiao'],
  qcId: ['qcid', 'qc', 'qcname', 'nguoiqc', 'qcincharge'],
  difficulty: ['difficulty', 'level', 'dokho', 'mucdo'],
  price: ['price', 'priceperchapter', 'dongia', 'rate'],
  feedback: ['feedback', 'note', 'ghichu', 'phanhoi'],
  completionPercent: ['completionpercent', 'percent', 'progress', 'phantramhoanthanh', 'hoanthanh', '100']
};

function findGoogleSheetHeaderRow(values) {
  const headerKeys = ['seriesId', 'chapterNumber', 'difficulty', 'status'];
  let bestIndex = -1;
  let bestScore = 0;
  values.forEach((row, index) => {
    const normalizedHeaders = new Set(row.map(normalizeSheetHeader));
    const score = headerKeys.reduce((total, key) => (
      googleSheetHeaderAliases[key].some((alias) => normalizedHeaders.has(alias)) ? total + 1 : total
    ), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex === -1 || bestScore < 2) {
    throw validationError('Không tìm thấy dòng tiêu đề hợp lệ. Cần có ít nhất các cột GE ID/seriesId, Chap/chapter và Difficulty/Độ khó.');
  }
  return bestIndex;
}

function getSheetValue(row, headerIndex, key, fieldOverride = null) {
  const aliases = key === 'seriesId' && normalizeSheetHeader(fieldOverride) === 'latin'
    ? ['azid']
    : googleSheetHeaderAliases[key] || [];
  const index = aliases.map((alias) => headerIndex.get(alias)).find((value) => value !== undefined);
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

function isDecorativeGoogleSheetRow(row, headerIndex, fieldOverride = null) {
  const populatedCells = row.filter((cell) => String(cell ?? '').trim()).length;
  if (populatedCells === 0) return true;
  const seriesId = getSheetValue(row, headerIndex, 'seriesId', fieldOverride);
  const chapterNumber = getSheetValue(row, headerIndex, 'chapterNumber');
  return populatedCells === 1 && !seriesId && !chapterNumber;
}

function isIncompleteGoogleSheetRow(row, headerIndex, fieldOverride = null) {
  const seriesId = getSheetValue(row, headerIndex, 'seriesId', fieldOverride);
  const chapterNumber = getSheetValue(row, headerIndex, 'chapterNumber');
  const difficulty = getSheetValue(row, headerIndex, 'difficulty');
  const price = getSheetValue(row, headerIndex, 'price');
  return !seriesId || !chapterNumber || (!difficulty && !price);
}

function parseImportedInteger(value, label, rowNumber, { required = false } = {}) {
  if (!String(value ?? '').trim()) {
    if (required) throw validationError(`Dòng ${rowNumber}: thiếu ${label}.`);
    return null;
  }
  const text = String(value).replace(/,/g, '').trim();
  const direct = Number(text);
  const embedded = !/[\d]+[.]\d+/.test(text) ? text.match(/\d+/)?.[0] : null;
  const parsed = Number.isInteger(direct) ? direct : Number(embedded);
  if (!Number.isInteger(parsed) || parsed < 0) throw validationError(`Dòng ${rowNumber}: ${label} phải là số nguyên không âm.`);
  return parsed;
}

function parseImportedMoney(value, label, rowNumber) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const cleaned = text.replace(/[^\d,.-]/g, '');
  const normalized = /^-?\d{1,3}(\.\d{3})+$/.test(cleaned)
    ? cleaned.replace(/\./g, '')
    : cleaned.replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw validationError(`Dòng ${rowNumber}: ${label} không hợp lệ.`);
  return parsed;
}

function parseImportedDate(value, label, rowNumber) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 10_000 && serial < 100_000) return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString();
  }
  const vietnameseDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?$/);
  const shortDate = text.match(/^(\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?$/);
  const parsed = vietnameseDate
    ? new Date(Number(vietnameseDate[3]), Number(vietnameseDate[2]) - 1, Number(vietnameseDate[1]), Number(vietnameseDate[4] || 0), Number(vietnameseDate[5] || 0), Number(vietnameseDate[6] || 0))
    : shortDate
      ? new Date(new Date().getFullYear(), Number(shortDate[2]) - 1, Number(shortDate[1]), Number(shortDate[3] || 0), Number(shortDate[4] || 0), Number(shortDate[5] || 0))
    : new Date(text);
  if (Number.isNaN(parsed.getTime())) throw validationError(`Dòng ${rowNumber}: ${label} không hợp lệ.`);
  return parsed.toISOString();
}

function normalizeImportedStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return null;
  if (['doing', 'submitted', 'checking', 'fixing', 'done'].includes(status)) return status;
  if (/đang thực hiện|đang làm/.test(status)) return 'doing';
  if (/đã gửi|chờ qc|submitted/.test(status)) return 'submitted';
  if (/đang kiểm tra|checking/.test(status)) return 'checking';
  if (/đang sửa|fixing/.test(status)) return 'fixing';
  if (/hoàn thành|completed|complete|done/.test(status)) return 'done';
  return null;
}

function resolveImportedReference(value, rows, idKeys, nameKeys) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  const normalized = text.toLowerCase();
  const match = rows.find((row) => nameKeys.some((key) => String(row[key] ?? '').trim().toLowerCase() === normalized));
  const idKey = match && idKeys.find((key) => match[key] !== undefined);
  return match && idKey ? Number(match[idKey]) : null;
}

function normalizeImportedField(value, fields, rowNumber) {
  const text = String(value ?? '').trim();
  const field = fields.find((item) => String(item.name).toLowerCase() === text.toLowerCase());
  if (!field) throw validationError(`Dòng ${rowNumber}: mảng "${text || '(trống)'}" chưa được cấu hình.`);
  return field.name;
}

function buildImportedDeadline(row, headerIndex, fields, prices, freelancers, qcs, rowNumber, fieldOverride = null) {
  const seriesIdLabel = normalizeSheetHeader(fieldOverride) === 'latin' ? 'AZ ID' : 'seriesId';
  const seriesId = parseImportedInteger(getSheetValue(row, headerIndex, 'seriesId', fieldOverride), seriesIdLabel, rowNumber, { required: true });
  const chapterNumber = parseImportedInteger(getSheetValue(row, headerIndex, 'chapterNumber'), 'chapterNumber', rowNumber, { required: true });
  if (chapterNumber < 1) throw validationError(`Dòng ${rowNumber}: chapter phải lớn hơn 0.`);
  const type = fieldOverride || normalizeImportedField(getSheetValue(row, headerIndex, 'type'), fields, rowNumber);
  const importedPrice = parseImportedMoney(getSheetValue(row, headerIndex, 'price'), 'Price per chapter', rowNumber);
  const difficultyFromSheet = getSheetValue(row, headerIndex, 'difficulty');
  const difficulty = difficultyFromSheet || (importedPrice !== null ? 'Imported' : '');
  if (!difficulty) throw validationError(`Dòng ${rowNumber}: thiếu difficulty và Price per chapter.`);
  const endTask = parseImportedDate(getSheetValue(row, headerIndex, 'endTask'), 'endTask', rowNumber);
  const submittedAt = parseImportedDate(getSheetValue(row, headerIndex, 'submittedAt'), 'submittedAt', rowNumber);
  const rawStatus = getSheetValue(row, headerIndex, 'statusRaw') || getSheetValue(row, headerIndex, 'status') || 'Đang thực hiện';
  const status = normalizeImportedStatus(getSheetValue(row, headerIndex, 'status') || rawStatus);
  const configuredPrice = prices.find((item) => String(item.field).toLowerCase() === type.toLowerCase() && String(item.difficulty).toLowerCase() === difficulty.toLowerCase());
  const price = importedPrice ?? configuredPrice?.price;
  if (price === null || price === undefined) throw validationError(`Dòng ${rowNumber}: chưa có giá cho mảng "${type}" và độ khó "${difficulty}".`);
  const completionText = getSheetValue(row, headerIndex, 'completionPercent');
  const completionPercent = completionText === '' ? 100 : Number(completionText.replace('%', '').trim());
  if (!Number.isInteger(completionPercent) || completionPercent < 0 || completionPercent > 200) {
    throw validationError(`Dòng ${rowNumber}: completionPercent phải là số nguyên từ 0 đến 200.`);
  }
  const fIld = resolveImportedReference(getSheetValue(row, headerIndex, 'fIld'), freelancers, ['fIld', 'fId', 'id'], ['name', 'email']);
  const qcId = resolveImportedReference(getSheetValue(row, headerIndex, 'qcId'), qcs, ['qcId', 'id'], ['name', 'email']);
  return {
    seriesId,
    chapterNumber,
    endTask,
    ...(submittedAt ? { submittedAt } : {}),
    seriesName: nullableText(getSheetValue(row, headerIndex, 'seriesName')),
    type,
    statusRaw: nullableText(rawStatus) || 'Đang thực hiện',
    status,
    urlSeries: nullableText(getSheetValue(row, headerIndex, 'urlSeries')),
    fIld,
    qcId,
    difficulty,
    feedback: nullableText(getSheetValue(row, headerIndex, 'feedback')),
    completionPercent,
    price,
    receivePrice: calculateReceivePrice(price, completionPercent)
  };
}

async function syncGoogleSheet() {
  if (googleSheetSyncPromise) return googleSheetSyncPromise;
  googleSheetSyncPromise = (async () => {
    const settings = await getGeneralSettings();
    const sheetUrl = normalizeGoogleSheetUrl(settings.googleSheetUrl);
    if (!sheetUrl) throw validationError('Chưa cấu hình link Google Sheet trong Cấu hình chung.');
    const tabs = await readGoogleSheetTabs({ ...settings, googleSheetUrl: sheetUrl });
    const [fields, prices, freelancers, qcs, currentRows] = await Promise.all([
      getConfiguredFields(),
      getCollection('difficultyPricing'),
      getCollection('freelancers'),
      getCollection('qcs'),
      getCollection('deadlines')
    ]);
    const mappedRows = [];
    const skippedRows = [];
    for (const tab of tabs) {
      const headerRowIndex = findGoogleSheetHeaderRow(tab.values);
      if (tab.values.length <= headerRowIndex + 1) throw validationError(`Tab "${tab.range}" chưa có dữ liệu bên dưới dòng tiêu đề.`);
      const headers = tab.values[headerRowIndex].map(normalizeSheetHeader);
      const headerIndex = new Map(headers.map((header, index) => [header, index]));
      const fieldOverride = tab.field ? normalizeImportedField(tab.field, fields, 1) : null;
      tab.values.slice(headerRowIndex + 1)
        .map((row, index) => ({ row, rowNumber: index + headerRowIndex + 2 }))
         .filter(({ row }) => !isDecorativeGoogleSheetRow(row, headerIndex, fieldOverride))
         .forEach(({ row, rowNumber }) => {
           if (isIncompleteGoogleSheetRow(row, headerIndex, fieldOverride)) {
            skippedRows.push({ tab: tab.range, rowNumber });
            return;
          }
          mappedRows.push({
            tab: tab.range,
            data: buildImportedDeadline(row, headerIndex, fields, prices, freelancers, qcs, rowNumber, fieldOverride)
          });
        });
    }
    if (mappedRows.length === 0) throw validationError('Không có dòng deadline hợp lệ để đồng bộ.');
    const uniqueRowsByKey = new Map();
    let duplicateRows = 0;
    for (const entry of mappedRows) {
      const row = entry.data;
      const key = `${row.seriesId}:${row.chapterNumber}`;
      if (uniqueRowsByKey.has(key)) duplicateRows += 1;
      uniqueRowsByKey.set(key, entry);
    }
    const uniqueRows = [...uniqueRowsByKey.values()];

    const allowedColumns = ['endTask', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status', 'doingStartedAt', 'workDurationSeconds', 'urlSeries', 'fIld', 'qcId', 'difficulty', 'price', 'receivePrice', 'feedback', 'completionPercent'];
    let inserted = 0;
    let updated = 0;
    for (const { data: row } of uniqueRows) {
      const current = currentRows.find((item) => Number(item.seriesId) === row.seriesId && Number(item.chapterNumber) === row.chapterNumber);
      if (current) {
        await updateRow('deadlines', { seriesId: row.seriesId, chapterNumber: row.chapterNumber }, row, allowedColumns);
        updated += 1;
      } else {
        await insertRow('deadlines', {
          ...row,
          doingStartedAt: row.status === 'doing' ? new Date().toISOString() : null,
          workDurationSeconds: 0
        }, ['seriesId', 'chapterNumber', ...allowedColumns]);
        inserted += 1;
      }
    }

    const syncedAt = new Date().toISOString();
    const currentSettings = (await getCollection('generalSettings'))[0];
    if (currentSettings) {
      await updateRow('generalSettings', { id: currentSettings.id }, {
        googleSheetLastSyncedAt: syncedAt,
        googleSheetLastSyncCount: uniqueRows.length,
        googleSheetLastSyncError: skippedRows.length || duplicateRows
          ? `Bỏ qua ${skippedRows.length} dòng thiếu dữ liệu và ${duplicateRows} dòng trùng series ID + Chap; ưu tiên bản ghi cuối.`
          : ''
      }, ['googleSheetLastSyncedAt', 'googleSheetLastSyncCount', 'googleSheetLastSyncError']);
    }
    return { inserted, updated, total: uniqueRows.length, skipped: skippedRows.length, duplicates: duplicateRows, skippedRows: skippedRows.slice(0, 20), syncedAt };
  })().catch(async (error) => {
    try {
      const currentSettings = (await getCollection('generalSettings'))[0];
      if (currentSettings) {
        await updateRow('generalSettings', { id: currentSettings.id }, { googleSheetLastSyncError: error.message }, ['googleSheetLastSyncError']);
      }
    } catch {
      // Preserve the original Google Sheet error.
    }
    throw error;
  }).finally(() => {
    googleSheetSyncPromise = null;
  });
  return googleSheetSyncPromise;
}

async function syncGoogleSheetIfDue() {
  const settings = await getGeneralSettings();
  if (settings.googleSheetAutoSync !== true || !settings.googleSheetUrl) return;
  const lastSyncedAt = settings.googleSheetLastSyncedAt ? new Date(settings.googleSheetLastSyncedAt).getTime() : 0;
  if (Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < 5 * 60 * 1000) return;
  try {
    await syncGoogleSheet();
  } catch (error) {
    console.error('Google Sheet auto sync failed:', error.message);
  }
}

function getTaskStatus(task) {
  const value = String(task?.status || task?.statusRaw || '').trim().toLowerCase();
  if (value === 'doing' || /đang thực hiện|đang làm/.test(value)) return 'doing';
  if (value === 'submitted' || /đã gửi|chờ qc/.test(value)) return 'submitted';
  if (value === 'done' || /hoàn thành|completed|complete/.test(value)) return 'done';
  return value;
}

function isTaskComplete(task) {
  return getTaskStatus(task) === 'done';
}

function getTaskDueTime(task) {
  const value = task?.endTask || task?.deadline || task?.dueDate;
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isTaskDueSoon(task, now = Date.now()) {
  const dueTime = getTaskDueTime(task);
  if (dueTime === null || ['submitted', 'done'].includes(getTaskStatus(task))) return false;
  const remaining = dueTime - now;
  return remaining >= 0 && remaining <= 3 * 60 * 60 * 1000;
}

function decorateDeadlineTiming(deadline) {
  const storedSeconds = Math.max(0, Number(deadline.workDurationSeconds || 0));
  const liveSeconds = deadline.doingStartedAt && !deadline.submittedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(deadline.doingStartedAt).getTime()) / 1000))
    : 0;
  const workDurationSeconds = storedSeconds + liveSeconds;
  return {
    ...deadline,
    workDurationSeconds,
    workDurationHours: Number((workDurationSeconds / 3600).toFixed(2))
  };
}

function validateTaskStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (!status) return null;
  if (!['doing', 'submitted', 'checking', 'fixing', 'done'].includes(status)) {
    throw validationError('Status phải là Doing, Submitted, Checking, Fixing hoặc Done.');
  }
  return status;
}

function buildStatusTransition(current, nextStatus) {
  const currentStoredSeconds = Math.max(0, Number(current.workDurationSeconds || 0));
  const currentLiveSeconds = current.doingStartedAt && !current.submittedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(current.doingStartedAt).getTime()) / 1000))
    : 0;
  const completedSeconds = currentStoredSeconds + currentLiveSeconds;
  if (nextStatus === 'doing') {
    return {
      status: nextStatus,
      doingStartedAt: String(current.status || '').toLowerCase() === 'doing' && current.doingStartedAt
         ? current.doingStartedAt
         : new Date().toISOString(),
      workDurationSeconds: currentStoredSeconds,
      submittedAt: null
    };
  }
  if (current.doingStartedAt && !current.submittedAt && nextStatus !== 'submitted') {
    return {
      status: nextStatus,
      doingStartedAt: current.doingStartedAt,
      workDurationSeconds: currentStoredSeconds,
      submittedAt: null
    };
  }
  return {
    status: nextStatus,
    doingStartedAt: null,
    workDurationSeconds: completedSeconds,
    submittedAt: nextStatus === 'submitted' ? new Date().toISOString() : (current.submittedAt || null)
  };
}

function calculateReceivePrice(price, completionPercent) {
  const numericPrice = Number(price);
  const numericPercent = Number(completionPercent);
  if (!Number.isFinite(numericPrice) || !Number.isFinite(numericPercent)) return null;
  return (numericPrice * numericPercent / 100).toFixed(2);
}

function validatePricingPayload(payload, partial = false) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu giá tiền không hợp lệ.');
  const result = {};
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'field')) {
    result.field = normalizeConfiguredFieldName(payload.field);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'difficulty')) {
    const difficulty = String(payload.difficulty ?? '').trim();
    if (!difficulty || difficulty.length > 100) throw validationError('Độ khó phải có từ 1 đến 100 ký tự.');
    result.difficulty = difficulty;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'price')) {
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price < 0) throw validationError('Giá tiền phải là số không âm.');
    result.price = price;
  }
  if (Object.keys(result).length === 0) throw validationError('Cần có ít nhất một trường để cập nhật.');
  return result;
}

function validateDifficultyLevelPayload(payload, partial = false) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu độ khó không hợp lệ.');
  const result = {};
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'field')) {
    result.field = normalizeConfiguredFieldName(payload.field);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'difficulty')) {
    const difficulty = String(payload.difficulty ?? '').trim();
    if (!difficulty || difficulty.length > 100) throw validationError('Độ khó phải có từ 1 đến 100 ký tự.');
    result.difficulty = difficulty;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'color')) {
    const color = String(payload.color ?? '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw validationError('Màu phải ở định dạng HEX, ví dụ #B20823.');
    result.color = color.toUpperCase();
  }
  if (Object.keys(result).length === 0) throw validationError('Cần có ít nhất một trường để cập nhật.');
  return result;
}

async function assertDifficultyLevelExists(field, difficulty) {
  const levels = await selectRows('difficultyLevels');
  const exists = levels.some((item) => item.field === field && item.difficulty === difficulty);
  if (!exists) throw validationError('Hãy set độ khó cho mảng trước khi nhập giá tiền.');
}

async function getBonusSettings() {
  const rows = await getCollection('bonusSettings');
  return rows[0] || { id: 1, taskThreshold: 20, bonusPerTask: 10000 };
}

function buildSalaryRows(freelancers, deadlines, bonusSettings) {
  const taskThreshold = Number(bonusSettings.taskThreshold);
  const bonusPerTask = Number(bonusSettings.bonusPerTask);
  const safeThreshold = Number.isInteger(taskThreshold) && taskThreshold >= 0 ? taskThreshold : 20;
  const safeBonusPerTask = Number.isFinite(bonusPerTask) && bonusPerTask >= 0 ? bonusPerTask : 10000;

  return freelancers.map((freelancer) => {
    const freelancerId = freelancer.fIld ?? freelancer.fId ?? freelancer.id;
    const freelancerDeadlines = deadlines.filter((deadline) => (
      String(deadline.fIld ?? deadline.fId ?? deadline.freelancerId ?? '') === String(freelancerId)
    ));
    const completedTaskCount = freelancerDeadlines.filter((deadline) => Number(deadline.completionPercent ?? 100) === 100).length;
    const earnedAmount = freelancerDeadlines.reduce((total, deadline) => total + getDeadlineEarning(deadline), 0);
    const bonusTaskCount = Math.max(0, completedTaskCount - safeThreshold);
    const bonus = bonusTaskCount * safeBonusPerTask;

    return {
      ...freelancer,
      earnedAmount: earnedAmount.toFixed(2),
      completedTaskCount,
      bonusTaskCount,
      bonus: bonus.toFixed(2),
      totalSalary: (earnedAmount + bonus).toFixed(2),
      bonusThreshold: safeThreshold,
      bonusPerTask: safeBonusPerTask
    };
  });
}

function getDeadlineEarning(deadline) {
  const receivePrice = Number(deadline.receivePrice);
  if (Number.isFinite(receivePrice)) return receivePrice;

  const price = Number(deadline.price);
  const completionPercent = Number(deadline.completionPercent ?? 100);
  return Number.isFinite(price) && Number.isFinite(completionPercent)
    ? price * completionPercent / 100
    : 0;
}

function validateDeadlineCreatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu deadline không hợp lệ.');

  const seriesId = Number(payload.seriesId);
  const chapterNumber = Number(payload.chapterNumber);
  if (!Number.isInteger(seriesId) || seriesId < 0) throw validationError('ID bộ truyện phải là số nguyên không âm.');
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) throw validationError('Chapter phải là số nguyên dương.');

  const type = String(payload.type ?? '').trim();
  const difficulty = String(payload.difficulty ?? '').trim();
  normalizeConfiguredFieldName(type);
  if (!difficulty || difficulty.length > 100) throw validationError('Độ khó phải có từ 1 đến 100 ký tự.');

  const completionPercent = payload.completionPercent === null || payload.completionPercent === undefined || payload.completionPercent === ''
    ? 100
    : Number(payload.completionPercent);
  if (!Number.isInteger(completionPercent) || completionPercent < 0 || completionPercent > 200) {
    throw validationError('% hoàn thành phải là số nguyên từ 0 đến 200.');
  }

  return {
    seriesId,
    chapterNumber,
    endTask: normalizeDeadlineDate(payload.endTask, 'Hạn DL'),
    submittedAt: normalizeDeadlineDate(payload.submittedAt, 'Ngày nộp'),
    seriesName: nullableText(payload.seriesName),
    type,
    status: validateTaskStatus(payload.status),
    doingStartedAt: null,
    workDurationSeconds: 0,
    statusRaw: nullableText(payload.statusRaw) || 'Đang thực hiện',
    urlSeries: nullableText(payload.urlSeries),
    fIld: nullableInteger(payload.fIld, 'Freelancer'),
    qcId: nullableInteger(payload.qcId, 'QC'),
    difficulty,
    feedback: nullableText(payload.feedback),
    completionPercent
  };
}

function nullableText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function nullableInteger(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw validationError(label + ' phải là số nguyên không âm.');
  return number;
}

function nullableField(value, role) {
  const field = String(value ?? '').trim();
  if (!field) {
    if (['Freelancer', 'QC'].includes(role)) throw validationError('Account phải chọn ít nhất một mảng đã cấu hình.');
    return null;
  }
  normalizeConfiguredFieldName(field);
  return field;
}

function normalizeStoredFields(value, fallback) {
  const values = Array.isArray(value) && value.length > 0 ? value : fallback;
  return [...new Set(String(values ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => isValidConfiguredFieldName(item)))];
}

function normalizeAccountFields(value, fallback, role) {
  const rawValues = Array.isArray(value) && value.length > 0 ? value : fallback;
  const fields = [...new Set((Array.isArray(rawValues) ? rawValues : String(rawValues ?? '').split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
  if (fields.some((field) => !isValidConfiguredFieldName(field))) {
    throw validationError('Mảng có tên không hợp lệ.');
  }
  if (['Freelancer', 'QC'].includes(role) && fields.length === 0) {
    throw validationError('Account phải chọn ít nhất một mảng đã cấu hình.');
  }
  if (role === 'Freelancer' && fields.length > 1) {
    throw validationError('Freelancer chỉ được chọn một mảng.');
  }
  return fields;
}

function normalizeDeadlineDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(label + ' không hợp lệ.');
  return date.toISOString();
}

function validateBonusSettingsPayload(payload) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu bonus không hợp lệ.');

  const taskThreshold = Number(payload.taskThreshold);
  const bonusPerTask = Number(payload.bonusPerTask);
  if (!Number.isInteger(taskThreshold) || taskThreshold < 0) {
    throw validationError('Số task đạt 100% phải là số nguyên không âm.');
  }
  if (!Number.isFinite(bonusPerTask) || bonusPerTask < 0) {
    throw validationError('Bonus mỗi task phải là số không âm.');
  }

  return { taskThreshold, bonusPerTask };
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
  req.authUser = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
  if (user.role !== 'Admin') return res.status(403).json({ success: false, message: 'Chỉ Admin được quản lý account.' });
  req.authUser = user;
  next();
}

function requireManager(req, res, next) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập.' });
  if (!['Admin', 'QC'].includes(user.role)) {
    return res.status(403).json({ success: false, message: 'Freelancer chỉ được xem dữ liệu của mình.' });
  }
  req.authUser = user;
  next();
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function getAuthUser(req) {
  const token = getBearerToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session.user;
}

function filterRowsForUser(rows, user) {
  if (user?.role !== 'Freelancer') return rows;
  if (user.freelancerId === null || user.freelancerId === undefined || user.freelancerId === '') return [];
  return rows.filter((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === String(user.freelancerId));
}

function filterSalaryRowsForUser(rows, user) {
  if (user?.role === 'Admin') return rows;
  if (['Freelancer', 'QC'].includes(user?.role)) {
    if (user.freelancerId === null || user.freelancerId === undefined || user.freelancerId === '') return [];
    return rows.filter((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === String(user.freelancerId));
  }
  return [];
}

function invalidateAccountSessions(accountId) {
  for (const [token, session] of sessions.entries()) {
    if (String(session.user?.id) === String(accountId)) sessions.delete(token);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function verifyPassword(password, hash, salt) {
  try {
    const expected = Buffer.from(hash, 'hex');
    const actual = Buffer.from(hashPassword(password, salt).hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function toPublicAccount(account, freelancers = []) {
  const linkedFreelancer = freelancers.find((freelancer) => String(freelancer.fIld ?? freelancer.fId ?? freelancer.id) === String(account.freelancerId ?? ''));
  const fields = normalizeStoredFields(account.fields || linkedFreelancer?.fields, account.field || linkedFreelancer?.field);
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    email: account.email || '',
    role: account.role,
    field: fields[0] || '',
    fields,
    freelancerId: account.freelancerId ?? null,
    freelancerName: linkedFreelancer?.name || '',
    imageQR: linkedFreelancer?.imageQR || '',
    isActive: account.isActive !== false,
    createdAt: account.createdAt
  };
}

function validateAccountPayload(payload) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu account không hợp lệ.');
  const username = String(payload.username ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  const displayName = String(payload.displayName ?? '').trim();
  const email = String(payload.email ?? '').trim() || null;
  const role = String(payload.role ?? '').trim();
  const fields = normalizeAccountFields(payload.fields, payload.field, role);
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw validationError('Username dài 3-50 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  if (password.length < 6) throw validationError('Password phải có ít nhất 6 ký tự.');
  if (!['Admin', 'QC', 'Freelancer'].includes(role)) throw validationError('Role phải là Admin, QC hoặc Freelancer.');
  if (!displayName || displayName.length > 150) throw validationError('Họ và tên không được để trống và tối đa 150 ký tự.');
  if (email && email.length > 255) throw validationError('Email không hợp lệ.');
  return { username, password, displayName, email, role, field: fields[0] || null, fields, freelancerId: null };
}

function validateFreelancerUpdatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu freelancer không hợp lệ.');
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = String(payload.name ?? '').trim();
    if (!name || name.length > 150) throw validationError('Họ và tên freelancer không được để trống và tối đa 150 ký tự.');
    updates.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    const email = String(payload.email ?? '').trim() || null;
    if (email && email.length > 255) throw validationError('Email freelancer không hợp lệ.');
    updates.email = email;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'field')) {
    updates.field = nullableField(payload.field, 'Freelancer');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'note')) {
    const note = String(payload.note ?? '').trim() || null;
    updates.note = note;
  }
  if (Object.keys(updates).length === 0) throw validationError('Cần có ít nhất một trường để cập nhật freelancer.');
  return updates;
}

function validateAccountUpdatePayload(payload, current) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu account không hợp lệ.');
  const result = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'username')) {
    const username = String(payload.username ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw validationError('Username dài 3-50 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.');
    result.username = username;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'password')) {
    const password = String(payload.password ?? '');
    if (password && password.length < 6) throw validationError('Password phải có ít nhất 6 ký tự.');
    if (password) result.password = password;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'displayName')) {
    const displayName = String(payload.displayName ?? '').trim();
    if (!displayName || displayName.length > 150) throw validationError('Họ và tên không được để trống và tối đa 150 ký tự.');
    result.displayName = displayName;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    const email = String(payload.email ?? '').trim() || null;
    if (email && email.length > 255) throw validationError('Email không hợp lệ.');
    result.email = email;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'role')) {
    const role = String(payload.role ?? '').trim();
    if (!['Admin', 'QC', 'Freelancer'].includes(role)) throw validationError('Role phải là Admin, QC hoặc Freelancer.');
    result.role = role;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'field')) {
    result.field = nullableField(payload.field, result.role || current.role);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'fields')) {
    result.fields = normalizeAccountFields(payload.fields, payload.field, result.role || current.role);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
    result.isActive = payload.isActive === true || payload.isActive === 'true' || payload.isActive === 1 || payload.isActive === '1';
  }

  const nextRole = result.role || current.role;
  const nextFields = Object.prototype.hasOwnProperty.call(result, 'fields')
    ? result.fields
    : normalizeAccountFields(current.fields, result.field ?? current.field, nextRole, true);
  if (['Freelancer', 'QC'].includes(nextRole) && nextFields.length === 0) {
    throw validationError('Account phải chọn ít nhất một mảng đã cấu hình.');
  }
  if (nextRole === 'Freelancer' && nextFields.length > 1) {
    throw validationError('Freelancer chỉ được chọn một mảng.');
  }
  result.fields = ['Freelancer', 'QC'].includes(nextRole) ? nextFields : [];
  result.field = nextFields[0] || null;
  result.freelancerId = ['Freelancer', 'QC'].includes(nextRole) ? (current.freelancerId ?? null) : null;

  if (Object.keys(result).length === 3 && Object.prototype.hasOwnProperty.call(result, 'freelancerId') && Object.prototype.hasOwnProperty.call(result, 'field') && Object.prototype.hasOwnProperty.call(result, 'fields') && !Object.prototype.hasOwnProperty.call(payload, 'role') && !Object.prototype.hasOwnProperty.call(payload, 'field') && !Object.prototype.hasOwnProperty.call(payload, 'fields')) {
    throw validationError('Cần có ít nhất một trường để cập nhật.');
  }
  return result;
}

async function assertFreelancerExists(freelancerId, role) {
  if (!['Freelancer', 'QC'].includes(role)) return;
  const freelancers = await getCollection('freelancers');
  const exists = freelancers.some((freelancer) => String(freelancer.fIld ?? freelancer.fId ?? freelancer.id) === String(freelancerId));
  if (!exists) throw validationError('Freelancer được liên kết không tồn tại.');
}

async function ensureFreelancerForAccount(account) {
  if (!['Freelancer', 'QC'].includes(account.role)) return null;
  if (account.freelancerId !== null && account.freelancerId !== undefined && account.freelancerId !== '') {
    return Number(account.freelancerId);
  }

  const freelancers = await getCollection('freelancers');
  const nextId = freelancers.reduce((maxId, freelancer) => {
    const freelancerId = Number(freelancer.fIld ?? freelancer.fId ?? freelancer.id);
    return Number.isInteger(freelancerId) ? Math.max(maxId, freelancerId) : maxId;
  }, 0) + 1;
  const created = await insertRow(
    'freelancers',
    {
      fIld: nextId,
      name: account.displayName,
      email: account.email || null,
      field: account.field || null,
      fields: account.fields || (account.field ? [account.field] : []),
      note: null,
      salary: null,
      imageQR: null
    },
    ['fIld', 'name', 'email', 'field', 'fields', 'note', 'salary', 'imageQR']
  );
  return created.fIld ?? nextId;
}

async function assertFreelancerAccountAvailable(freelancerId, accountId = null) {
  if (freelancerId === null || freelancerId === undefined || freelancerId === '') return;
  const accounts = await getCollection('accounts');
  const alreadyLinked = accounts.find((account) => (
    String(account.freelancerId ?? '') === String(freelancerId)
      && String(account.id) !== String(accountId ?? '')
  ));
  if (alreadyLinked) throw validationError('Freelancer này đã được liên kết với một account khác.');
}

async function syncFreelancerFromAccount(account) {
  if (!['Freelancer', 'QC'].includes(account.role) || account.freelancerId === null || account.freelancerId === undefined) return;
  await updateRow(
    'freelancers',
    { fIld: account.freelancerId },
    {
      name: account.displayName,
      email: account.email || null,
      field: account.field || null,
      fields: account.fields || (account.field ? [account.field] : [])
    },
    ['name', 'email', 'field', 'fields']
  );
}
