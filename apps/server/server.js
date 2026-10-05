import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { calculateBonus, getSalaryMonth, isSalaryMonth, resolveBonusRule, validateBonusRule } from './bonus.mjs';
import { getMailConfig, sendEmail } from './mailTransport.mjs';
import { createTaskReminderWorker, reminderPagination, validateReminderConfiguration, validateReminderStore } from './taskReminderWorker.mjs';
import { createWebPushWorker, getWebPushConfig, pushSubscriptionId, sendWebPush, validatePushSubscription, validateWebPushStore } from './webPush.mjs';
import {
  deleteRowById,
  deleteRowsByKeys,
  getDataSource,
  insertRow,
  isDatabaseConfigured,
  selectRows,
  taskReminderStore,
  webPushStore,
  updateRow,
  updateRowById
} from './supabaseRepository.js';
import {
  getAvatarStoragePath,
  getErrorScreenshotStoragePath,
  getQrStoragePath,
  isAvatarStorageConfigured,
  isErrorScreenshotStorageConfigured,
  isQrStorageConfigured,
  removeAvatars,
  removeErrorScreenshots,
  removeQrCodes,
  uploadAvatar,
  uploadQrCode,
  uploadErrorScreenshot
} from './supabaseStorage.js';

const app = express();
const PORT = process.env.PORT || 5000;
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const PASSWORD_RESET_OTP_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const passwordResetChallenges = new Map();
const PRESENCE_TTL_MS = 90 * 1000;
const ACCOUNT_ROLES = ['Admin', 'QC', 'Freelancer'];
const ROLE_PRIORITY = { Freelancer: 1, QC: 2, Admin: 3 };
const GOOGLE_REQUEST_TIMEOUT_MS = 30_000;
const SYNC_WRITE_CONCURRENCY = 8;
const GOOGLE_DRIVE_FOLDER_CACHE_TTL_MS = 10 * 60 * 1000;
const DEADLINE_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DEADLINE_TIME_ZONE_OFFSET = '+07:00';
const DEADLINE_REGISTRATION_STABILITY_OPTIONS = ['Trong tháng', '2-3 tháng kế', 'cố định mỗi tháng'];

const corsOptions = {
  origin: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Active-Role'],
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '16mb' }));

const emptyCollections = {
  tasks: [],
  freelancers: [],
  qcs: [],
  accounts: [],
  deadlineRegistrations: [],
  deadlines: [],
  difficultyLevels: [],
  difficultyPricing: [],
  bonusSettings: [],
  fields: [],
  generalSettings: [],
  errors: []
};

async function runWithConcurrency(items, worker, concurrency = SYNC_WRITE_CONCURRENCY) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

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

async function sendFieldScopedCollection(collection, req, res) {
  try {
    const rows = await getCollection(collection);
    if (req.authUser.role === 'Admin') {
      return res.json({ success: true, data: rows });
    }

    const visibleFields = await getVisibleFields(req.authUser);
    const allowedFields = new Set(visibleFields.map((field) => String(field.name || '').trim().toLowerCase()));
    const scopedRows = rows.filter((row) => allowedFields.has(String(row.field || '').trim().toLowerCase()));
    return res.json({ success: true, data: scopedRows });
  } catch (error) {
    return res.status(502).json({ success: false, message: error.message });
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Webtoon Deadline Management API',
    dataSource: getDataSource(),
    screenshotStorageConfigured: isErrorScreenshotStorageConfigured()
  });
});

app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
  try {
    await syncGoogleSheetIfDue({ waitForCompletion: false });
    const [tasks, deadlineRows, settings] = await Promise.all([
      getCollection('tasks'),
      getCollection('deadlines'),
      getGeneralSettings()
    ]);
    const deadlines = deadlineRows.map(normalizeDeadlineForResponse);
    const scopedTasks = filterRowsForUser(tasks, req.authUser);
    const scopedDeadlines = filterRowsForUser(deadlines, req.authUser);
    const trackedTasks = scopedDeadlines.length > 0 ? scopedDeadlines : scopedTasks;
    const upcomingTasks = trackedTasks
      .filter((task) => isTaskDueSoon(task))
      .sort((left, right) => getTaskDueTime(left) - getTaskDueTime(right));
    const fieldResources = (await getVisibleFields(req.authUser)).map((field) => ({
      field: field.name,
      guideUrl: field.guideUrl || '',
      resourceUrl: field.resourceUrl || '',
      checklists: settings.checklists?.[field.name] || []
    }));
    const legacyLinks = req.authUser.role === 'Freelancer'
      ? { guideUrl: fieldResources[0]?.guideUrl || '', resourceUrl: fieldResources[0]?.resourceUrl || '' }
      : { guideUrl: process.env.GUIDE_URL || '', resourceUrl: process.env.RESOURCE_URL || '' };
    const trackedTaskSource = scopedDeadlines.length > 0 ? scopedDeadlines : scopedTasks;
    const pipelineTotal = trackedTaskSource.length;
    const completed = trackedTaskSource.filter((item) => (
      req.authUser.role === 'Freelancer'
        ? ['submitted', 'checking', 'done'].includes(getTaskStatus(item))
        : getTaskStatus(item) === 'done'
    )).length;
    const assigned = scopedTasks.filter(hasFreelancerAssignment).length;
    const review = trackedTaskSource.filter((item) => ['submitted', 'checking'].includes(getTaskStatus(item))).length;
    const waiting = trackedTaskSource.filter((item) => (
      getTaskStatus(item) !== 'done'
      && !['submitted', 'checking'].includes(getTaskStatus(item))
      && !hasFreelancerAssignment(item)
    )).length;
    const processing = trackedTaskSource.filter((item) => (
      getTaskStatus(item) !== 'done'
      && !['submitted', 'checking'].includes(getTaskStatus(item))
      && hasFreelancerAssignment(item)
    )).length;
    const activeForFreelancer = trackedTaskSource.filter((item) => !['submitted', 'checking', 'done'].includes(getTaskStatus(item))).length;

    res.json({
      success: true,
      data: {
        guideUrl: legacyLinks.guideUrl,
        resourceUrl: legacyLinks.resourceUrl,
        fieldResources,
        pipelineTotalTasks: pipelineTotal,
        waitingTasks: waiting,
        processingTasks: processing,
        assignedTasks: assigned,
        reviewTasks: review,
        completedTasks: completed,
        activeTasks: activeForFreelancer,
        inProgressTasks: processing,
        upcomingTasks: req.authUser.role === 'Freelancer' ? upcomingTasks : []
      }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    await syncGoogleSheetIfDue({ waitForCompletion: false });
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
    const onlineAccountIds = getOnlineAccountIds();
    const scopedFreelancers = filterFreelancerRowsForUser(freelancers, req.authUser);
    const data = scopedFreelancers.map((freelancer) => {
      const freelancerId = freelancer.fIld ?? freelancer.fId ?? freelancer.id;
      const account = accounts.find((item) => String(item.freelancerId ?? '') === String(freelancerId));
      return {
        ...freelancer,
        avatar: account?.avatar || freelancer.avatar || '',
        isOnline: Boolean(account && onlineAccountIds.has(String(account.id))),
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

app.get('/api/deadline-registrations', requireAuth, async (req, res) => {
  try {
    const [rows, freelancers] = await Promise.all([
      getCollection('deadlineRegistrations'),
      getCollection('freelancers')
    ]);
    const visibleRows = filterDeadlineRegistrationRowsForUser(rows, req.authUser);
    const data = visibleRows.map((row) => {
      const freelancer = freelancers.find((item) => String(getFreelancerId(item)) === String(row.fIld ?? row.fId ?? row.freelancerId ?? ''));
      return toPublicDeadlineRegistration(row, freelancer);
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.post('/api/deadline-registrations', requireAuth, async (req, res) => {
  try {
    const forcedFreelancerId = req.authUser.role === 'Freelancer' ? req.authUser.freelancerId : undefined;
    const payload = validateDeadlineRegistrationPayload(req.body, { forcedFreelancerId });
    const freelancers = await getCollection('freelancers');
    const freelancer = freelancers.find((item) => String(getFreelancerId(item)) === String(payload.fIld));
    if (!freelancer) throw validationError('Freelancer không tồn tại trong hệ thống.');

    const existingRows = await getCollection('deadlineRegistrations');
    if (existingRows.some((row) => String(row.fIld ?? '') === String(payload.fIld))) {
      return res.status(409).json({ success: false, message: 'Freelancer này đã có đăng ký deadline.' });
    }

    const now = new Date().toISOString();
    const data = await insertRow('deadlineRegistrations', {
      ...payload,
      name: freelancer.name,
      createdAt: now,
      updatedAt: now
    }, ['fIld', 'name', 'chaptersPerWeek', 'chaptersPerMonth', 'stability', 'note', 'createdAt', 'updatedAt']);
    res.status(201).json({ success: true, data: toPublicDeadlineRegistration(data, freelancer) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.code === '23505' ? 'Freelancer này đã có đăng ký deadline.' : error.message });
  }
});

app.patch('/api/deadline-registrations/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID đăng ký deadline không hợp lệ.' });

  try {
    const rows = await getCollection('deadlineRegistrations');
    const current = rows.find((row) => Number(row.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy đăng ký deadline cần cập nhật.' });
    if (req.authUser.role === 'Freelancer' && String(current.fIld ?? '') !== String(req.authUser.freelancerId ?? '')) {
      return res.status(403).json({ success: false, message: 'Freelancer chỉ được sửa thông tin của mình.' });
    }

    const forcedFreelancerId = req.authUser.role === 'Freelancer' ? current.fIld : undefined;
    const payload = validateDeadlineRegistrationPayload({ ...current, ...req.body }, { forcedFreelancerId });
    const freelancers = await getCollection('freelancers');
    const freelancer = freelancers.find((item) => String(getFreelancerId(item)) === String(payload.fIld));
    if (!freelancer) throw validationError('Freelancer không tồn tại trong hệ thống.');
    if (rows.some((row) => Number(row.id) !== id && String(row.fIld ?? '') === String(payload.fIld))) {
      return res.status(409).json({ success: false, message: 'Freelancer này đã có đăng ký deadline.' });
    }

    const data = await updateRowById(
      'deadlineRegistrations',
      id,
      { ...payload, name: freelancer.name, updatedAt: new Date().toISOString() },
      ['fIld', 'name', 'chaptersPerWeek', 'chaptersPerMonth', 'stability', 'note', 'updatedAt']
    );
    res.json({ success: true, data: toPublicDeadlineRegistration(data, freelancer) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.code === '23505' ? 'Freelancer này đã có đăng ký deadline.' : error.message });
  }
});

app.delete('/api/deadline-registrations/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID đăng ký deadline không hợp lệ.' });

  try {
    const rows = await getCollection('deadlineRegistrations');
    const current = rows.find((row) => Number(row.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy đăng ký deadline cần xóa.' });
    if (req.authUser.role === 'Freelancer' && String(current.fIld ?? '') !== String(req.authUser.freelancerId ?? '')) {
      return res.status(403).json({ success: false, message: 'Freelancer chỉ được xóa thông tin của mình.' });
    }
    const data = await deleteRowById('deadlineRegistrations', id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
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

async function getMergedQCs() {
  const [qcs, accounts] = await Promise.all([
    getCollection('qcs'),
    getCollection('accounts')
  ]);
  const accountQcs = accounts
    .filter((account) => hasAccountRole(account, 'QC'))
    .map((account) => ({
      qcId: account.id,
      accountId: account.id,
      freelancerId: account.freelancerId ?? null,
      name: account.displayName || account.username,
      email: account.email || null,
      imageQR: null,
      field: account.field || null,
      fields: account.fields || (account.field ? [account.field] : [])
    }));
  return [...qcs, ...accountQcs].reduce((rows, row) => {
    const id = row.qcId ?? row.id;
    const existingIndex = rows.findIndex((item) => String(item.qcId ?? item.id) === String(id));
    if (existingIndex === -1) rows.push({ ...row, qcId: id });
    else rows[existingIndex] = { ...rows[existingIndex], ...row, qcId: id };
    return rows;
  }, []);
}

app.get('/api/qcs', requireAuth, async (req, res) => {
  try {
    const merged = await getMergedQCs();
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
    if (hasAnyRole(payload.roles, ['Freelancer', 'QC']) && payload.freelancerId === null) {
      payload.freelancerId = await ensureFreelancerForAccount(payload);
    }
    await assertFreelancerExists(payload.freelancerId, payload.roles);
    await assertFreelancerAccountAvailable(payload.freelancerId);
    const { hash, salt } = hashPassword(payload.password);
    const data = await insertRow(
      'accounts',
      {
        username: payload.username,
        passwordHash: hash,
        passwordSalt: salt,
        role: payload.role,
        roles: payload.roles,
        displayName: payload.displayName,
        email: payload.email,
        field: payload.field,
        fields: payload.fields,
        freelancerId: payload.freelancerId,
        isActive: true
      },
      ['username', 'passwordHash', 'passwordSalt', 'role', 'roles', 'displayName', 'email', 'field', 'fields', 'freelancerId', 'isActive']
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
    if (hasAnyRole(payload.roles, ['Freelancer', 'QC']) && payload.freelancerId === null) {
      payload.freelancerId = await ensureFreelancerForAccount({ ...current, ...payload });
    }
    await assertFreelancerExists(payload.freelancerId, payload.roles);
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
      ['username', 'passwordHash', 'passwordSalt', 'role', 'roles', 'displayName', 'email', 'field', 'fields', 'freelancerId', 'isActive']
    );
    await syncFreelancerFromAccount(data);
    invalidateAccountSessions(id);
    res.json({ success: true, data: toPublicAccount(data, await getCollection('freelancers')) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.code === '23505' ? 'Username đã tồn tại.' : error.message });
  }
});
app.delete('/api/accounts/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID account không hợp lệ.' });

  try {
    if (String(req.authUser.id) === String(id)) {
      return res.status(400).json({ success: false, message: 'Không thể tự xóa account đang đăng nhập.' });
    }
    const accounts = await getCollection('accounts');
    const current = accounts.find((account) => Number(account.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy account cần xóa.' });
    if (hasAccountRole(current, 'Admin') && accounts.filter((account) => hasAccountRole(account, 'Admin')).length <= 1) {
      return res.status(400).json({ success: false, message: 'Phải giữ lại ít nhất một account Admin.' });
    }

    const linkedFreelancerId = hasAnyRole(getAccountRoles(current), ['Freelancer', 'QC'])
      ? current.freelancerId
      : null;
    const hasAnotherAccountForFreelancer = linkedFreelancerId !== null
      && linkedFreelancerId !== undefined
      && linkedFreelancerId !== ''
      && accounts.some((account) => (
        Number(account.id) !== id
        && String(account.freelancerId ?? '') === String(linkedFreelancerId)
      ));
    const linkedFreelancers = linkedFreelancerId === null || linkedFreelancerId === undefined || linkedFreelancerId === ''
      ? []
      : await getCollection('freelancers');
    const linkedFreelancer = linkedFreelancers.find((freelancer) => (
      String(freelancer.fIld ?? freelancer.fId ?? freelancer.id ?? '') === String(linkedFreelancerId)
    ));
    const freelancerDeleteKey = linkedFreelancer?.fIld !== undefined
      ? { fIld: linkedFreelancer.fIld }
      : linkedFreelancer?.fId !== undefined
        ? { fId: linkedFreelancer.fId }
        : linkedFreelancer?.id !== undefined
          ? { id: linkedFreelancer.id }
          : null;
    const linkedQcs = hasAccountRole(current, 'QC') ? await getCollection('qcs') : [];
    const accountName = String(current.displayName || current.username || '').trim().toLowerCase();
    const accountEmail = String(current.email || '').trim().toLowerCase();
    const qcDeleteKeys = linkedQcs
      .filter((qc) => {
        const qcId = qc.qcId ?? qc.id;
        const qcName = String(qc.name || qc.displayName || qc.username || '').trim().toLowerCase();
        const qcEmail = String(qc.email || '').trim().toLowerCase();
        return String(qcId ?? '') === String(id)
          || (accountEmail && qcEmail === accountEmail)
          || (accountName && qcName === accountName);
      })
      .map((qc) => qc.qcId !== undefined ? { qcId: qc.qcId } : qc.id !== undefined ? { id: qc.id } : null)
      .filter(Boolean);
    const data = await deleteRowById('accounts', id);
    if (!hasAnotherAccountForFreelancer && freelancerDeleteKey) {
      await deleteRowsByKeys('freelancers', freelancerDeleteKey);
    }
    await runWithConcurrency(qcDeleteKeys, async (keys) => deleteRowsByKeys('qcs', keys));
    invalidateAccountSessions(id);
    res.json({ success: true, data: toPublicAccount(data, await getCollection('freelancers')) });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/deadlines', requireAuth, async (req, res) => {
  try {
    const refreshDrive = req.query?.refreshDrive === '1';
    if (refreshDrive) googleDriveFolderCache.clear();
    await syncGoogleSheetIfDue({ waitForCompletion: false });
    const allDeadlines = await getCollection('deadlines');
    const settings = await getGeneralSettings();
    // Re-check missing/stale Drive links on every deadline load. The lookup
    // layer keeps a short cache, so a normal page load does not repeatedly hit
    // Google Drive while still repairing links that were previously missing.
    const linkedDeadlines = await enrichStoredDeadlineUrls(allDeadlines, settings.googleDriveFolders);
    const deadlines = filterRowsForUser(linkedDeadlines, req.authUser);
    const prices = await getCollection('difficultyPricing');
    res.json({ success: true, data: applyConfiguredPrices(deadlines, prices) });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.get('/api/difficulty-levels', requireAuth, (req, res) => sendFieldScopedCollection('difficultyLevels', req, res));
app.get('/api/difficulty-prices', requireAuth, (req, res) => sendFieldScopedCollection('difficultyPricing', req, res));
app.get('/api/bonus-settings', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, data: await getBonusSettings() });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.get('/api/general-settings', requireAuth, async (req, res) => {
  try {
    const settings = await getGeneralSettings();
    if (req.authUser.role === 'Admin') {
      try {
        const mailConfig = validateReminderConfiguration();
        await validateReminderStore(taskReminderStore, mailConfig);
        settings.taskReminderConfiguration = { ready: true, message: '' };
      } catch (error) {
        settings.taskReminderConfiguration = { ready: false, message: error.message };
      }
    }
    if (req.authUser.role === 'Freelancer') {
      res.json({ success: true, data: { ...settings, errorSheetUrls: {} } });
      return;
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});
app.patch('/api/general-settings', requireAdmin, async (req, res) => {
  try {
    const current = (await getCollection('generalSettings'))[0];
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'taskRemindersEnabled')) {
      if (typeof req.body.taskRemindersEnabled !== 'boolean') throw validationError('taskRemindersEnabled phải là boolean.');
      if (req.body.taskRemindersEnabled) {
        await validateReminderStore(taskReminderStore, validateReminderConfiguration());
      }
      updates.taskRemindersEnabled = req.body.taskRemindersEnabled;
    }
    const updatesDriveFolders = Object.prototype.hasOwnProperty.call(req.body || {}, 'googleDriveFolders');
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetUrl')) {
      updates.googleSheetUrl = normalizeGoogleSheetUrl(req.body.googleSheetUrl);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetRange')) {
      updates.googleSheetRange = nullableText(req.body.googleSheetRange);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetTabs')) {
      updates.googleSheetTabs = JSON.stringify(normalizeGoogleSheetTabs(req.body.googleSheetTabs));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleDriveFolders')) {
      updates.googleDriveFolders = JSON.stringify(normalizeGoogleDriveFolders(req.body.googleDriveFolders));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'errorSheetUrls')) {
      updates.errorSheetUrls = JSON.stringify(normalizeErrorSheetUrls(req.body.errorSheetUrls));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'checklists')) {
      updates.checklists = JSON.stringify(normalizeChecklists(req.body.checklists));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'googleSheetAutoSync')) {
      updates.googleSheetAutoSync = req.body.googleSheetAutoSync === true;
    }
    const data = current
      ? await updateRow('generalSettings', { id: current.id }, updates, ['googleSheetUrl', 'googleSheetRange', 'googleSheetTabs', 'googleDriveFolders', 'errorSheetUrls', 'checklists', 'googleSheetAutoSync', 'taskRemindersEnabled'])
      : await insertRow('generalSettings', { id: 1, ...updates }, ['id', 'googleSheetUrl', 'googleSheetRange', 'googleSheetTabs', 'googleDriveFolders', 'errorSheetUrls', 'checklists', 'googleSheetAutoSync', 'taskRemindersEnabled']);
    if (updatesDriveFolders) googleDriveFolderCache.clear();
    const safeData = { ...data };
    delete safeData.googleDriveRawTransferAuth;
    delete safeData.googleDriveRawTransfer;
    res.json({ success: true, data: safeData });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/task-reminders', requireAdmin, async (req, res) => {
  try {
    const pagination = reminderPagination(req.query);
    const data = await taskReminderStore('list', pagination);
    res.json({ success: true, data: { ...data, ...pagination } });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.statusCode === 400 ? error.message : 'Không thể tải lịch sử nhắc task. Kiểm tra migration và kết nối database.' });
  }
});
app.post('/api/google-sheet/sync', requireAdmin, async (req, res) => {
  try {
    // A manual sync is also the explicit "recheck Drive" action. Avoid
    // returning folder results cached before the mapping or Drive structure
    // was corrected.
    googleDriveFolderCache.clear();
    const result = await syncGoogleSheet();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: getSafeErrorMessage(error, 'Không thể đồng bộ Google Sheet.') });
  }
});
app.get('/api/errors', requireAuth, async (req, res) => {
  try {
    const settings = await getGeneralSettings();
    const rows = filterErrorRowsForUser(await getCollection('errors'), req.authUser);
    const data = rows.map((row) => {
      if (req.authUser.role === 'Freelancer') {
        const { sourceSheetUrl, sourceUrl, sourceRow, ...visibleRow } = row;
        return visibleRow;
      }
      return {
        ...row,
        sourceSheetUrl: getConfiguredErrorSheetUrl(settings.errorSheetUrls, row.field) || row.sourceUrl || ''
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.post('/api/errors', requireManager, async (req, res) => {
  try {
    const payload = await validateErrorPayload(req.body, req.authUser);
    payload.screenshot = await materializeErrorScreenshot(payload.screenshot, `pending/${crypto.randomUUID()}`);
    const now = new Date().toISOString();
    const data = await insertRow('errors', {
      ...payload,
      fixCheck: false,
      sourceRow: null,
      sourceUrl: getConfiguredErrorSheetUrl((await getGeneralSettings()).errorSheetUrls, payload.field),
      createdAt: now,
      updatedAt: now
    }, ['field', 'title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editor', 'editorFreelancerId', 'fixCheck', 'sourceRow', 'sourceUrl', 'createdAt', 'updatedAt']);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.post('/api/errors/sync', requireManager, async (req, res) => {
  try {
    const result = await withErrorSheetLock(() => syncErrorsWithGoogleSheets(req.authUser));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: getSafeErrorMessage(error, 'Không thể đồng bộ bảng lỗi.') });
  }
});
app.get('/api/errors/fix-check', requireAuth, async (req, res) => {
  try {
    const data = await withErrorSheetLock(() => refreshErrorFixChecks(req.authUser));
    res.set('Cache-Control', 'no-store').json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: getSafeErrorMessage(error, 'Không thể đồng bộ Fix/Check từ Sheet.') });
  }
});
app.post('/api/errors/migrate-screenshots', requireAdmin, async (req, res) => {
  try {
    const result = await migrateLegacyErrorScreenshots(await getCollection('errors'));
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: getSafeErrorMessage(error, 'Không thể chuyển screenshot lên Supabase Storage.') });
  }
});
app.patch('/api/errors/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID lỗi không hợp lệ.' });

  try {
    await withErrorSheetLock(async () => {
      const rows = await getCollection('errors');
      const current = rows.find((row) => Number(row.id) === id);
      if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy lỗi cần cập nhật.' });
      const updates = req.authUser.role === 'Freelancer'
        ? validateFreelancerErrorUpdatePayload(req.body, current, req.authUser)
        : await validateErrorUpdatePayload(req.body, req.authUser, current);
      const previousScreenshot = current.screenshot;
      if (Object.prototype.hasOwnProperty.call(updates, 'screenshot')) {
        updates.screenshot = await materializeErrorScreenshot(updates.screenshot, id);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'fixCheck')) {
        await writeErrorFixCheck(current, updates.fixCheck);
      }
      updates.updatedAt = new Date().toISOString();
      const data = await updateRowById(
        'errors',
        id,
        updates,
        ['field', 'title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editor', 'editorFreelancerId', 'fixCheck', 'sourceRow', 'sourceUrl', 'updatedAt']
      );
      if (Object.prototype.hasOwnProperty.call(updates, 'screenshot')) {
        const nextPaths = new Set(getStoragePathsFromErrorScreenshot(data.screenshot));
        const obsoletePaths = getStoragePathsFromErrorScreenshot(previousScreenshot).filter((path) => !nextPaths.has(path));
        if (obsoletePaths.length > 0) void removeErrorScreenshots(obsoletePaths).catch((error) => console.error('Không thể dọn screenshot cũ:', error.message));
      }
      res.json({ success: true, data });
    });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.delete('/api/errors/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'ID lỗi không hợp lệ.' });

  try {
    const rows = await getCollection('errors');
    const current = rows.find((row) => Number(row.id) === id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy lỗi cần xóa.' });
    assertManagerCanManageField(req.authUser, current.field);
    const data = await deleteRowById('errors', id);
    void removeErrorScreenshotFiles(current.screenshot);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});
app.get('/api/salaries', requireAuth, async (req, res) => {
  try {
    const month = req.query.month ?? null;
    if (month !== null && !isSalaryMonth(month)) throw validationError('Tháng lương phải có định dạng YYYY-MM.');
    await syncGoogleSheetIfDue({ waitForCompletion: false });
    const [freelancers, qcProfiles, deadlines, prices, bonusSettings] = await Promise.all([
      getCollection('freelancers'),
      getMergedQCs(),
      getCollection('deadlines'),
      getCollection('difficultyPricing'),
      getBonusSettings()
    ]);
    const qcs = mergeQCSalaryProfiles(qcProfiles);
    // A QC account also gets a linked Freelancer profile so the account can
    // share identity/contact data. That profile is not a second salary row:
    // the QC account must only appear in the QC section below.
    const qcLinkedFreelancerIds = new Set(qcs
      .map((qc) => qc.freelancerId)
      .filter((id) => id !== null && id !== undefined && id !== '')
      .map(String));
    const salaryFreelancers = freelancers.filter((freelancer) => {
      const freelancerId = freelancer.fIld ?? freelancer.fId ?? freelancer.id;
      return !qcLinkedFreelancerIds.has(String(freelancerId));
    });
    const canViewAllSalaries = ['Admin', 'QC'].includes(req.authUser.role);
    const scopedFreelancers = canViewAllSalaries ? salaryFreelancers : filterSalaryRowsForUser(salaryFreelancers, req.authUser);
    const scopedQcs = req.authUser.role === 'Freelancer'
      ? []
      : (canViewAllSalaries ? qcs : filterQCSalaryRowsForUser(qcs, req.authUser));
    const scopedDeadlines = canViewAllSalaries ? deadlines : filterSalaryDeadlinesForUser(deadlines, req.authUser);
    const pricedDeadlines = applyConfiguredPrices(scopedDeadlines, prices);
    const payableDeadlines = pricedDeadlines.filter((deadline) => (
      deadline.paymentApproved === true
      || deadline.paymentApproved === 1
      || String(deadline.paymentApproved).toLowerCase() === 'true'
    ));
    const salaryDeadlines = payableDeadlines.filter((deadline) => {
      // The default salary table includes every approved chapter, even without a date.
      if (month === null) return true;
      const submittedMonth = getSalaryMonth(deadline.submittedAt);
      return submittedMonth === month;
    });
    const undatedDeadlines = month === null ? [] : payableDeadlines.filter((deadline) => !getSalaryMonth(deadline.submittedAt));
    const payableQCDebt = salaryDeadlines.filter((deadline) => getTaskStatus(deadline) === 'done');
    res.json({
      success: true,
        data: scopedDeadlines.length === 0
        ? []
        : [
            ...buildSalaryRows(scopedFreelancers, salaryDeadlines, bonusSettings, month, undatedDeadlines),
            ...buildQCSalaryRows(scopedQcs, payableQCDebt, bonusSettings, month)
          ]
    });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.post('/api/reset-all', requireAdmin, async (req, res) => {
  try {
    const syncSettings = await getGeneralSettings();
    if (normalizeGoogleSheetUrl(syncSettings.googleSheetUrl)) await syncGoogleSheet();
    const currentRows = await getCollection('deadlines');
    const deadlineKeys = new Map();
    currentRows.forEach((row) => {
      if (row.seriesId === null || row.seriesId === undefined || row.chapterNumber === null || row.chapterNumber === undefined) return;
      deadlineKeys.set(`${row.seriesId}:${row.chapterNumber}`, {
        seriesId: row.seriesId,
        chapterNumber: row.chapterNumber
      });
    });

    const deletedCounts = await runWithConcurrency([...deadlineKeys.values()], async (keys) => {
      const deletedRows = await deleteRowsByKeys('deadlines', keys);
      return deletedRows.length;
    });
    const deletedDeadlines = deletedCounts.reduce((total, count) => total + count, 0);

    // Keep the configured Sheet connection unchanged, but prevent an immediate
    // automatic sync from restoring the deleted rows on the next dashboard load.
    const currentSettings = (await getCollection('generalSettings'))[0];
    if (currentSettings) {
      await updateRow(
        'generalSettings',
        { id: currentSettings.id },
        { googleSheetLastSyncedAt: new Date().toISOString(), googleSheetLastSyncCount: 0 },
        ['googleSheetLastSyncedAt', 'googleSheetLastSyncCount']
      );
    }

    res.json({ success: true, data: { deletedDeadlines, salaryReset: true } });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.post('/api/deadlines', requireManager, async (req, res) => {
  try {
    const payload = validateDeadlineCreatePayload(req.body);
    await assertConfiguredFields([payload.type]);
    if (payload.assignedAdminId !== null) {
      if (req.authUser.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Chỉ Admin được giao task cho tài khoản Admin.' });
      }
      await assertAdminAssignment(payload.assignedAdminId);
    }
    if (payload.status === 'doing') payload.doingStartedAt = new Date().toISOString();
    const prices = await selectRows('difficultyPricing');
    const configuredPrice = payload.difficulty
      ? prices.find((item) => item.field === payload.type && item.difficulty === payload.difficulty)
      : null;
    if (payload.difficulty && !configuredPrice) {
      return res.status(400).json({ success: false, message: 'Chưa có giá tiền cho mảng và độ khó đã chọn.' });
    }

    payload.price = configuredPrice?.price ?? null;
    payload.receivePrice = configuredPrice
      ? calculateReceivePrice(payload.price, payload.completionPercent)
      : null;
    const data = await insertDeadlineAndGoogleSheet(
      payload,
      ['seriesId', 'chapterNumber', 'endTask', 'receivedAt', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status', 'doingStartedAt', 'workDurationSeconds', 'urlSeries', 'fIld', 'assignedAt', 'assignedAdminId', 'qcId', 'difficulty', 'price', 'receivePrice', 'feedback', 'late', 'completionPercent']
    );
    res.status(201).json({ success: true, data: decorateDeadlineTiming(data) });
  } catch (error) {
    res.status(error.statusCode || (error.code === '23505' ? 409 : 502)).json({ success: false, message: error.message });
  }
});

app.patch('/api/deadlines/:seriesId/:chapterNumber/status', requireAuth, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const chapterNumber = String(req.params.chapterNumber ?? '').trim();
  if (!Number.isInteger(seriesId) || !chapterNumber || chapterNumber.length > 100) {
    return res.status(400).json({ success: false, message: 'ID bộ truyện phải là số nguyên và Chapter phải là chuỗi từ 1 đến 100 ký tự.' });
  }

  try {
    const currentRows = await selectRows('deadlines');
    const current = currentRows.find((item) => Number(item.seriesId) === seriesId && String(item.chapterNumber ?? '').trim() === chapterNumber);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy deadline cần cập nhật.' });
    if (req.authUser.role === 'Freelancer' && String(current.fIld ?? '') !== String(req.authUser.freelancerId ?? '')) {
      return res.status(403).json({ success: false, message: 'Freelancer chỉ được cập nhật task của mình.' });
    }
    const status = validateTaskStatus(req.body?.status);
    if (req.authUser.role === 'Freelancer' && !['doing', 'submitted'].includes(status)) {
      return res.status(403).json({ success: false, message: 'Freelancer chỉ được chọn Doing hoặc Submitted.' });
    }
    const updates = buildStatusTransition(current, status);
    const data = await updateDeadlineAndGoogleSheet(
      { seriesId, chapterNumber },
      updates,
      ['status', 'doingStartedAt', 'workDurationSeconds', 'submittedAt']
    );
    res.json({ success: true, data: decorateDeadlineTiming(data) });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.patch('/api/deadlines/:seriesId/:chapterNumber', requireAuth, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const chapterNumber = String(req.params.chapterNumber ?? '').trim();
  if (!Number.isInteger(seriesId) || !chapterNumber || chapterNumber.length > 100) {
    return res.status(400).json({ success: false, message: 'ID bộ truyện phải là số nguyên và Chapter phải là chuỗi từ 1 đến 100 ký tự.' });
  }

  try {
    const currentRows = await selectRows('deadlines');
    const current = currentRows.find((item) => Number(item.seriesId) === seriesId && String(item.chapterNumber ?? '').trim() === chapterNumber);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy deadline cần cập nhật.' });

    if (req.authUser.role === 'Freelancer') {
      if (String(current.fIld ?? '') !== String(req.authUser.freelancerId ?? '')) {
        return res.status(403).json({ success: false, message: 'Freelancer chỉ được sửa task của mình.' });
      }
      const freelancerUpdates = req.body && typeof req.body === 'object' ? req.body : {};
      const forbiddenFields = Object.keys(freelancerUpdates).filter((key) => !['status', 'feedback'].includes(key));
      if (forbiddenFields.length > 0) {
        return res.status(403).json({ success: false, message: 'Freelancer chỉ được sửa cột Status và Feedback.' });
      }

      const updates = {};
      if (Object.prototype.hasOwnProperty.call(freelancerUpdates, 'feedback')) {
        updates.feedback = nullableText(freelancerUpdates.feedback);
      }
      if (Object.prototype.hasOwnProperty.call(freelancerUpdates, 'status')) {
        const status = validateTaskStatus(freelancerUpdates.status);
        if (!['doing', 'submitted'].includes(status)) {
          return res.status(403).json({ success: false, message: 'Freelancer chỉ được chọn Doing hoặc Submitted.' });
        }
        Object.assign(updates, buildStatusTransition(current, status));
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'Freelancer chỉ được sửa cột Status và Feedback.' });
      }

      const data = await updateDeadlineAndGoogleSheet(
        { seriesId, chapterNumber },
        updates,
        ['status', 'doingStartedAt', 'workDurationSeconds', 'submittedAt', 'feedback']
      );
      return res.json({ success: true, data: decorateDeadlineTiming(data) });
    }

    const updates = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(updates, 'endTask')) {
      updates.endTask = normalizeDeadlineDueDate(updates.endTask, 'Hạn DL');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
      updates.status = validateTaskStatus(updates.status);
      Object.assign(updates, buildStatusTransition(current, updates.status));
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'assignedAdminId')) {
      if (req.authUser.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Chỉ Admin được giao task cho tài khoản Admin.' });
      }
      updates.assignedAdminId = nullableInteger(updates.assignedAdminId, 'Admin');
      await assertAdminAssignment(updates.assignedAdminId);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'fIld')) {
      updates.fIld = nullableInteger(updates.fIld, 'Freelancer');
      if (String(updates.fIld ?? '') !== String(current.fIld ?? '')) {
        updates.assignedAt = updates.fIld === null ? null : new Date().toISOString();
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'paymentApproved') && typeof updates.paymentApproved !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Trạng thái Thanh toán phải là true hoặc false.' });
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'late')) {
      updates.late = normalizeLateValue(updates.late, { strict: true });
    }
    const needsReprice = Object.prototype.hasOwnProperty.call(updates, 'difficulty')
      || Object.prototype.hasOwnProperty.call(updates, 'type');
    const nextField = updates.type ?? current.type;
    const hasDifficultyUpdate = Object.prototype.hasOwnProperty.call(updates, 'difficulty');
    const nextDifficulty = hasDifficultyUpdate
      ? String(updates.difficulty ?? '').trim()
      : String(current.difficulty ?? '').trim();
    if (hasDifficultyUpdate) updates.difficulty = nextDifficulty || null;
    if (Object.prototype.hasOwnProperty.call(updates, 'type')) await assertConfiguredFields([nextField]);
    const prices = await selectRows('difficultyPricing');
    const configuredPrice = nextDifficulty
      ? prices.find((item) => item.field === nextField && item.difficulty === nextDifficulty)
      : null;
    if (configuredPrice) {
      updates.price = configuredPrice.price;
    } else if (needsReprice && nextDifficulty) {
      return res.status(400).json({ success: false, message: 'Chưa có giá tiền cho mảng và độ khó đã chọn.' });
    } else if (needsReprice) {
      updates.price = null;
      updates.receivePrice = null;
    } else {
      delete updates.price;
    }

    if (!needsReprice || configuredPrice) {
      const nextPrice = Object.prototype.hasOwnProperty.call(updates, 'price') ? updates.price : current.price;
      const nextCompletionPercent = updates.completionPercent ?? current.completionPercent ?? 100;
      const calculatedReceivePrice = calculateReceivePrice(nextPrice, nextCompletionPercent);
      if (calculatedReceivePrice === null) {
        delete updates.receivePrice;
      } else {
        updates.receivePrice = calculatedReceivePrice;
      }
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

    const data = await updateDeadlineAndGoogleSheet(
      { seriesId, chapterNumber },
      updates,
      ['endTask', 'receivedAt', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status', 'doingStartedAt', 'workDurationSeconds', 'urlSeries', 'fIld', 'assignedAt', 'assignedAdminId', 'qcId', 'difficulty', 'price', 'receivePrice', 'feedback', 'late', 'paymentApproved', 'completionPercent']
    );
    res.json({ success: true, data: decorateDeadlineTiming(data) });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.delete('/api/deadlines/:seriesId/:chapterNumber', requireManager, async (req, res) => {
  const seriesId = Number(req.params.seriesId);
  const chapterNumber = String(req.params.chapterNumber ?? '').trim();
  if (!Number.isInteger(seriesId) || !chapterNumber || chapterNumber.length > 100) {
    return res.status(400).json({ success: false, message: 'ID bộ truyện phải là số nguyên và Chapter phải là chuỗi từ 1 đến 100 ký tự.' });
  }

  try {
    const settings = await getGeneralSettings();
    if (normalizeGoogleSheetUrl(settings.googleSheetUrl)) await syncGoogleSheet();
    const currentRows = await selectRows('deadlines');
    const current = currentRows.find((item) => Number(item.seriesId) === seriesId && String(item.chapterNumber ?? '').trim() === chapterNumber);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy deadline cần xóa.' });

    try {
      const deletedRows = await deleteRowsByKeys('deadlines', { seriesId, chapterNumber });
      res.json({ success: true, data: deletedRows[0] || current });
    } catch (error) {
      throw error;
    }
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

const difficultyLevelFields = ['field', 'difficulty', 'color', 'textColor'];
const pricingFields = ['field', 'difficulty', 'price'];
const bonusSettingsFields = ['field', 'bonusPolicy'];

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
    if (payload.field) await assertConfiguredFields([payload.field]);
    const currentRows = await selectRows('bonusSettings');
    const current = payload.field
      ? currentRows.find((row) => String(row.field || '') === String(payload.field))
      : currentRows.find((row) => !row.field);
    const updates = { field: payload.field, bonusPolicy: payload.rule };
    const data = current
      ? await updateRow('bonusSettings', { id: current.id }, updates, bonusSettingsFields)
      : await insertRow('bonusSettings', { id: Math.max(0, ...currentRows.map((row) => Number(row.id) || 0)) + 1, ...updates }, ['id', ...bonusSettingsFields]);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: error.message });
  }
});

app.patch('/api/profile', requireAuth, async (req, res) => {
  try {
    if (req.authUser.role === 'Freelancer' && Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      return res.status(403).json({ success: false, message: 'Freelancer không được tự thay đổi họ và tên. Vui lòng liên hệ Admin hoặc QC.' });
    }
    const accounts = await getCollection('accounts');
    const currentAccount = accounts.find((account) => String(account.id) === String(req.authUser.id));
    if (!currentAccount) return res.status(404).json({ success: false, message: 'Không tìm thấy account hiện tại.' });

    const accountUpdates = {};
    const hasAvatarUpdate = Object.prototype.hasOwnProperty.call(req.body || {}, 'avatar');
    const previousAvatarPath = hasAvatarUpdate ? getAvatarStoragePath(currentAccount.avatar) : null;
    let nextAvatarPath = null;
    let previousQrPath = null;
    let nextQrPath = null;
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
    if (hasAvatarUpdate) {
      accountUpdates.avatar = await materializeAvatar(req.body.avatar, currentAccount.id);
      nextAvatarPath = getAvatarStoragePath(accountUpdates.avatar);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
      const password = String(req.body.password ?? '');
      if (password.length < 6) throw validationError('Password phải có ít nhất 6 ký tự.');
      const { hash, salt } = hashPassword(password);
      accountUpdates.passwordHash = hash;
      accountUpdates.passwordSalt = salt;
    }

    const account = Object.keys(accountUpdates).length > 0
      ? await updateRowById('accounts', currentAccount.id, accountUpdates, ['displayName', 'email', 'avatar', 'passwordHash', 'passwordSalt'])
      : currentAccount;
    if (hasAvatarUpdate && previousAvatarPath && previousAvatarPath !== nextAvatarPath) {
      try {
        await removeAvatars([previousAvatarPath]);
      } catch (error) {
        console.error('Không thể dọn avatar cũ khỏi Supabase Storage:', error.message);
      }
    }
    if (Object.keys(accountUpdates).some((key) => ['displayName', 'email'].includes(key))) {
      await syncFreelancerFromAccount(account);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'imageQR')) {
      const freelancerId = account.freelancerId ?? req.authUser.freelancerId;
      if (freelancerId === null || freelancerId === undefined || freelancerId === '') {
        throw validationError('Account hiện tại chưa được liên kết với hồ sơ freelancer.');
      }
      const freelancers = await getCollection('freelancers');
      const currentFreelancer = freelancers.find((freelancer) => String(freelancer.fIld ?? freelancer.fId ?? freelancer.id) === String(freelancerId));
      previousQrPath = getQrStoragePath(currentFreelancer?.imageQR);
      const imageQR = await materializeQrCode(req.body.imageQR, freelancerId);
      nextQrPath = getQrStoragePath(imageQR);
      await updateRow('freelancers', { fIld: freelancerId }, { imageQR }, ['imageQR']);
      if (previousQrPath && previousQrPath !== nextQrPath) {
        try {
          await removeQrCodes([previousQrPath]);
        } catch (error) {
          console.error('Không thể dọn mã QR cũ khỏi Supabase Storage:', error.message);
        }
      }
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

    const linkedFreelancers = account.freelancerId !== null && account.freelancerId !== undefined && account.freelancerId !== ''
      ? await getCollection('freelancers') : [];
    const user = toPublicAccount(account, linkedFreelancers);
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    sessions.set(token, { user, expiresAt: now + SESSION_TTL_MS, lastSeenAt: now });
    res.json({ success: true, data: { token, user } });
  } catch (error) {
    res.status(502).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/forgot-password/request-otp', async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    if (!username) throw validationError('Vui lòng nhập username.');

    const accounts = await getCollection('accounts');
    const account = accounts.find((item) => (
      String(item.username || '').trim().toLowerCase() === username
      && item.isActive !== false
    ));
    const email = String(account?.email || '').trim();
    if (!account || !email) {
      return res.status(400).json({ success: false, message: 'Username không tồn tại hoặc chưa có email đăng ký.' });
    }

    cleanupPasswordResetChallenges();
    const previousRequest = [...passwordResetChallenges.values()].find((challenge) => (
      String(challenge.accountId) === String(account.id)
      && challenge.createdAt + PASSWORD_RESET_REQUEST_COOLDOWN_MS > Date.now()
    ));
    if (previousRequest) {
      return res.status(429).json({ success: false, message: 'Vui lòng đợi một phút trước khi yêu cầu mã OTP mới.' });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const challengeId = crypto.randomUUID();
    passwordResetChallenges.set(challengeId, {
      accountId: account.id,
      email,
      otpHash: hashPasswordResetOtp(otp),
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + PASSWORD_RESET_OTP_TTL_MS
    });

    try {
      await sendPasswordResetOtp(email, otp);
    } catch (error) {
      passwordResetChallenges.delete(challengeId);
      throw error;
    }

    res.json({
      success: true,
      data: {
        challengeId,
        maskedEmail: maskEmail(email),
        expiresInSeconds: PASSWORD_RESET_OTP_TTL_MS / 1000
      }
    });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: getSafeErrorMessage(error, 'Không thể gửi mã OTP lúc này.') });
  }
});

app.post('/api/auth/forgot-password/verify-otp', (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId ?? '').trim();
    const otp = String(req.body?.otp ?? '').trim();
    if (!challengeId || !/^\d{6}$/.test(otp)) throw validationError('Mã OTP phải gồm 6 chữ số.');

    const challenge = passwordResetChallenges.get(challengeId);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      passwordResetChallenges.delete(challengeId);
      return res.status(400).json({ success: false, message: 'Mã OTP đã hết hạn hoặc không hợp lệ.' });
    }
    if (challenge.verifiedAt) return res.status(400).json({ success: false, message: 'Mã OTP đã được xác nhận.' });
    if (challenge.attempts >= PASSWORD_RESET_OTP_MAX_ATTEMPTS) {
      passwordResetChallenges.delete(challengeId);
      return res.status(400).json({ success: false, message: 'Bạn đã nhập sai OTP quá số lần cho phép.' });
    }

    challenge.attempts += 1;
    if (!verifyPasswordResetOtp(otp, challenge.otpHash)) {
      const remaining = PASSWORD_RESET_OTP_MAX_ATTEMPTS - challenge.attempts;
      if (remaining <= 0) passwordResetChallenges.delete(challengeId);
      return res.status(400).json({ success: false, message: remaining > 0 ? `Mã OTP không đúng. Còn ${remaining} lần thử.` : 'Bạn đã nhập sai OTP quá số lần cho phép.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    challenge.verifiedAt = Date.now();
    challenge.resetToken = resetToken;
    passwordResetChallenges.delete(challengeId);
    passwordResetChallenges.set(resetToken, challenge);
    res.json({ success: true, data: { resetToken, expiresInSeconds: PASSWORD_RESET_OTP_TTL_MS / 1000 } });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/forgot-password/reset', async (req, res) => {
  try {
    const resetToken = String(req.body?.resetToken ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!resetToken) throw validationError('Phiên đặt lại mật khẩu không hợp lệ.');
    if (password.length < 6) throw validationError('Mật khẩu phải có ít nhất 6 ký tự.');

    const challenge = passwordResetChallenges.get(resetToken);
    if (!challenge?.verifiedAt || challenge.expiresAt <= Date.now()) {
      passwordResetChallenges.delete(resetToken);
      return res.status(400).json({ success: false, message: 'Phiên đặt lại mật khẩu đã hết hạn. Vui lòng yêu cầu OTP mới.' });
    }

    const { hash, salt } = hashPassword(password);
    await updateRowById('accounts', challenge.accountId, { passwordHash: hash, passwordSalt: salt }, ['passwordHash', 'passwordSalt']);
    invalidateAccountSessions(challenge.accountId);
    passwordResetChallenges.delete(resetToken);
    res.json({ success: true, data: { reset: true } });
  } catch (error) {
    res.status(error.statusCode || 502).json({ success: false, message: getSafeErrorMessage(error, 'Không thể đặt lại mật khẩu.') });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, data: req.authUser });
});

app.post('/api/auth/heartbeat', requireAuth, (req, res) => {
  res.json({ success: true, data: { online: true } });
});

app.get('/api/push/config', requireAuth, async (req, res) => {
  try {
    const config = getWebPushConfig();
    await validateWebPushStore(webPushStore);
    res.json({ success: true, data: { ready: true, publicKey: config.publicKey } });
  } catch (error) {
    res.json({ success: true, data: { ready: false, message: error.message } });
  }
});

app.post('/api/push/subscriptions', requireAuth, async (req, res) => {
  try {
    getWebPushConfig();
    const subscription = validatePushSubscription(req.body?.subscription);
    await webPushStore('subscribe', { subscriptionId: pushSubscriptionId(subscription), accountId: String(req.authUser.id), notificationRole: req.authUser.role, subscription });
    res.json({ success: true, data: { enabled: true } });
  } catch (error) {
    res.status(error.statusCode || 503).json({ success: false, message: error.statusCode ? error.message : 'Không thể lưu đăng ký thông báo. Vui lòng thử lại.' });
  }
});

app.delete('/api/push/subscriptions', requireAuth, async (req, res) => {
  try {
    const subscription = validatePushSubscription(req.body?.subscription);
    await webPushStore('remove', { subscriptionId: pushSubscriptionId(subscription), accountId: String(req.authUser.id) });
    res.json({ success: true, data: { enabled: false } });
  } catch (error) {
    res.status(error.statusCode || 503).json({ success: false, message: error.statusCode ? error.message : 'Không thể tắt thông báo trên máy chủ. Vui lòng thử lại.' });
  }
});

const pushTestRequests = new Map();
app.post('/api/push/test', requireAuth, async (req, res) => {
  try {
    const accountId = String(req.authUser.id);
    if (Date.now() - (pushTestRequests.get(accountId) || 0) < 60_000) return res.status(429).json({ success: false, message: 'Vui lòng chờ 1 phút trước khi gửi thử tiếp.' });
    const config = getWebPushConfig();
    const subscription = validatePushSubscription(req.body?.subscription);
    const device = await webPushStore('get', { subscriptionId: pushSubscriptionId(subscription), accountId });
    if (!device) return res.status(404).json({ success: false, message: 'Thiết bị chưa bật thông báo cho tài khoản này.' });
    pushTestRequests.set(accountId, Date.now());
    await sendWebPush(device.subscription, { title: 'WZ System — Đã bật thông báo', body: 'Thiết bị này đã sẵn sàng nhận nhắc deadline.', url: config.appUrl, tag: 'wz-push-test', accountId }, config);
    res.json({ success: true, data: { sent: true } });
  } catch (error) {
    res.status(error.statusCode === 400 ? 400 : 503).json({ success: false, message: 'Không gửi được thông báo thử. Kiểm tra quyền thông báo hoặc thử bật lại.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = getBearerToken(req);
  if (token) sessions.delete(token);
  res.json({ success: true, data: true });
});

const taskReminderWorker = createTaskReminderWorker({ selectRows, store: taskReminderStore });
const webPushWorker = createWebPushWorker({ selectRows, store: webPushStore });
const httpServer = app.listen(PORT, () => {
  console.log(`Webtoon Deadline Management API listening on port ${PORT}`);
  taskReminderWorker.start();
  if (process.env.WEB_PUSH_ENABLED === 'true') webPushWorker.start();
});
httpServer.on('close', () => { taskReminderWorker.stop(); webPushWorker.stop(); });
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
  return rows.sort((left, right) => Number(left.id) - Number(right.id));
}

async function getVisibleFields(user) {
  const fields = await getConfiguredFields();
  if (!['Freelancer', 'QC'].includes(user?.role)) return fields;

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
  if (rawValue.length > 5 * 1024 * 1024 || !/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(rawValue)) {
    throw validationError('Mã QR phải là ảnh PNG, JPG, WEBP hoặc GIF hợp lệ và không quá 3 MB.');
  }
  return rawValue;
}

function normalizeAvatarDataUrl(value) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;
  if (rawValue.length > 5 * 1024 * 1024 || !/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(rawValue)) {
    throw validationError('Ảnh đại diện phải là ảnh PNG, JPG, WEBP hoặc GIF hợp lệ và không quá 3 MB.');
  }
  return rawValue;
}

async function materializeAvatar(value, ownerKey) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;
  if (getAvatarStoragePath(rawValue)) return rawValue;
  if (!isAvatarStorageConfigured()) {
    throw validationError('Chưa cấu hình SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY để lưu avatar.');
  }

  const normalizedValue = normalizeAvatarDataUrl(rawValue);
  const image = parseErrorImageDataUrl(normalizedValue);
  if (!image) throw validationError('Ảnh đại diện không hợp lệ.');
  const extension = getErrorImageExtension(image.contentType);
  const path = `accounts/${String(ownerKey).replace(/[^a-z0-9_-]/gi, '_')}/${crypto.randomUUID()}.${extension}`;
  return uploadAvatar({ path, data: image.data, contentType: image.contentType });
}

async function materializeQrCode(value, ownerKey) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;
  if (getQrStoragePath(rawValue)) return rawValue;
  if (!isQrStorageConfigured()) {
    throw validationError('Chưa cấu hình SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY để lưu mã QR.');
  }

  const normalizedValue = normalizeImageDataUrl(rawValue);
  const image = parseErrorImageDataUrl(normalizedValue);
  if (!image) throw validationError('Mã QR không hợp lệ.');
  const extension = getErrorImageExtension(image.contentType);
  const path = `freelancers/${String(ownerKey).replace(/[^a-z0-9_-]/gi, '_')}/qr-cropped-v2-${crypto.randomUUID()}.${extension}`;
  return uploadQrCode({ path, data: image.data, contentType: image.contentType });
}

const MAX_ERROR_SCREENSHOT_COUNT = 3;
const MAX_ERROR_SCREENSHOT_ITEM_LENGTH = 5 * 1024 * 1024;
const MAX_ERROR_SCREENSHOT_TOTAL_LENGTH = 15 * 1024 * 1024;

function parseErrorScreenshotValues(value) {
  if (Array.isArray(value)) return value;
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return [];
  if (rawValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Keep treating the value as a legacy single-image value below.
    }
  }
  return [rawValue];
}

function normalizeErrorScreenshot(value, { strict = false } = {}) {
  const values = parseErrorScreenshotValues(value);
  if (values.length === 0) return null;
  if (values.length > MAX_ERROR_SCREENSHOT_COUNT) {
    if (strict) throw validationError(`Screenshot chỉ được tối đa ${MAX_ERROR_SCREENSHOT_COUNT} ảnh.`);
    return null;
  }

  const normalizedValues = values.map((valueItem) => {
    let rawValue = String(valueItem ?? '').trim();
    const imageFormulaMatch = rawValue.match(/^=IMAGE\(\s*["'](https?:\/\/[^"']+)["']/i);
    if (imageFormulaMatch) rawValue = imageFormulaMatch[1].trim();
    const isDataUrl = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(rawValue);
    const isRemoteImage = isHttpUrl(rawValue);
    if (rawValue.length > MAX_ERROR_SCREENSHOT_ITEM_LENGTH || (!isDataUrl && !isRemoteImage)) return null;
    return rawValue;
  });

  if (normalizedValues.some((valueItem) => !valueItem)) {
    if (strict) throw validationError('Screenshot phải là ảnh PNG, JPG, WEBP hoặc GIF hợp lệ, hoặc URL ảnh http/https và không quá 3 MB.');
    return null;
  }

  const normalized = normalizedValues.length === 1
    ? normalizedValues[0]
    : JSON.stringify(normalizedValues);
  if (normalized.length > MAX_ERROR_SCREENSHOT_TOTAL_LENGTH) {
    if (strict) throw validationError('Tổng dung lượng tối đa của 3 screenshot là 15 MB.');
    return null;
  }
  return normalized;
}

function getErrorScreenshotValues(value) {
  const normalized = normalizeErrorScreenshot(value);
  return normalized ? parseErrorScreenshotValues(normalized).map((item) => String(item)) : [];
}

function parseErrorImageDataUrl(value) {
  const match = String(value ?? '').trim().match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return {
    contentType: match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase(),
    data: Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  };
}

function getErrorImageExtension(contentType) {
  return {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  }[contentType] || 'img';
}

function getStoragePathsFromErrorScreenshot(value) {
  return getErrorScreenshotValues(value)
    .map(getErrorScreenshotStoragePath)
    .filter(Boolean);
}

async function materializeErrorScreenshot(value, ownerKey) {
  const normalized = normalizeErrorScreenshot(value);
  if (!normalized || !isErrorScreenshotStorageConfigured()) return normalized;

  const values = getErrorScreenshotValues(normalized);
  const storedValues = await runWithConcurrency(values, async (image, index) => {
    const dataUrl = parseErrorImageDataUrl(image);
    if (!dataUrl) return image;
    const path = `errors/${String(ownerKey).replace(/[^a-z0-9/_-]/gi, '_')}/${crypto.randomUUID()}-${index}.${getErrorImageExtension(dataUrl.contentType)}`;
    return uploadErrorScreenshot({ path, data: dataUrl.data, contentType: dataUrl.contentType });
  }, MAX_ERROR_SCREENSHOT_COUNT);
  return normalizeErrorScreenshot(storedValues, { strict: true });
}

async function removeErrorScreenshotFiles(value) {
  const paths = getStoragePathsFromErrorScreenshot(value);
  if (paths.length === 0) return;
  try {
    await removeErrorScreenshots(paths);
  } catch (error) {
    console.error('Không thể dọn screenshot khỏi Supabase Storage:', error.message);
  }
}

async function migrateLegacyErrorScreenshots(rows) {
  if (!isErrorScreenshotStorageConfigured()) {
    throw validationError('Chưa cấu hình SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY để dùng Supabase Storage.');
  }

  const candidates = rows.filter((row) => getErrorScreenshotValues(row.screenshot).some(parseErrorImageDataUrl));
  let migrated = 0;
  let failed = 0;
  const failures = [];
  await runWithConcurrency(candidates, async (row) => {
    try {
      const previousPaths = getStoragePathsFromErrorScreenshot(row.screenshot);
      const screenshot = await materializeErrorScreenshot(row.screenshot, row.id);
      await updateRowById('errors', row.id, { screenshot, updatedAt: new Date().toISOString() }, ['screenshot', 'updatedAt']);
      const nextPaths = new Set(getStoragePathsFromErrorScreenshot(screenshot));
      const obsoletePaths = previousPaths.filter((path) => !nextPaths.has(path));
      if (obsoletePaths.length > 0) void removeErrorScreenshots(obsoletePaths).catch((error) => console.error('Không thể dọn screenshot cũ sau khi migrate:', error.message));
      migrated += 1;
    } catch (error) {
      failed += 1;
      failures.push({ id: row.id, message: getSafeErrorMessage(error, 'Không thể chuyển screenshot lên Storage.') });
    }
  }, 4);
  return { scanned: rows.length, candidates: candidates.length, migrated, failed, failures: failures.slice(0, 20) };
}

function isValidConfiguredFieldName(value) {
  return /^[\p{L}][\p{L}\p{N} _-]{0,49}$/u.test(String(value ?? '').trim());
}

async function isConfiguredFieldInUse(name) {
  const [levels, prices, accounts, freelancers, deadlines, errors] = await Promise.all([
    getCollection('difficultyLevels'),
    getCollection('difficultyPricing'),
    getCollection('accounts'),
    getCollection('freelancers'),
    getCollection('deadlines'),
    getCollection('errors')
  ]);
  return levels.some((row) => row.field === name)
    || prices.some((row) => row.field === name)
    || accounts.some((row) => row.field === name || normalizeStoredFields(row.fields, row.field).includes(name))
    || freelancers.some((row) => row.field === name || normalizeStoredFields(row.fields, row.field).includes(name))
    || deadlines.some((row) => row.type === name)
    || errors.some((row) => row.field === name);
}

async function renameConfiguredField(previousName, nextName) {
  const [levels, prices, accounts, freelancers, deadlines, errors] = await Promise.all([
    getCollection('difficultyLevels'),
    getCollection('difficultyPricing'),
    getCollection('accounts'),
    getCollection('freelancers'),
    getCollection('deadlines'),
    getCollection('errors')
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
  await Promise.all(errors.filter((row) => row.field === previousName).map((row) => updateRowById('errors', row.id, { field: nextName }, ['field'])));
  const settings = (await getCollection('generalSettings'))[0];
  if (settings) {
    const errorSheetUrls = normalizeErrorSheetUrls(settings.errorSheetUrls);
    const checklists = normalizeChecklists(settings.checklists);
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(errorSheetUrls, previousName)) {
      errorSheetUrls[nextName] = errorSheetUrls[previousName];
      delete errorSheetUrls[previousName];
      updates.errorSheetUrls = JSON.stringify(errorSheetUrls);
    }
    if (Object.prototype.hasOwnProperty.call(checklists, previousName)) {
      checklists[nextName] = checklists[previousName];
      delete checklists[previousName];
      updates.checklists = JSON.stringify(checklists);
    }
    if (Object.keys(updates).length > 0) {
      await updateRow('generalSettings', { id: settings.id }, updates, ['errorSheetUrls', 'checklists']);
    }
  }
}

async function getGeneralSettings() {
  const rows = await getCollection('generalSettings');
  if (rows[0]) {
    const settings = { ...rows[0] };
    delete settings.deadlineHours;
    delete settings.googleDriveRawTransferAuth;
    delete settings.googleDriveRawTransfer;
    return {
      ...settings,
      taskRemindersEnabled: settings.taskRemindersEnabled === true,
      googleSheetTabs: parseGoogleSheetTabs(settings.googleSheetTabs),
      googleDriveFolders: normalizeGoogleDriveFolders(settings.googleDriveFolders),
      errorSheetUrls: normalizeErrorSheetUrls(settings.errorSheetUrls),
      checklists: normalizeChecklists(settings.checklists)
    };
  }
  return {
    id: 1,
    taskRemindersEnabled: false,
    googleSheetUrl: '',
    googleSheetRange: '',
    googleSheetTabs: {},
    googleDriveFolders: {},
    errorSheetUrls: {},
    checklists: {},
    googleSheetAutoSync: false,
    googleSheetLastSyncedAt: null,
    googleSheetLastSyncCount: 0,
    googleSheetLastSyncError: ''
  };
}

let googleAccessTokenCache = null;
let googleSheetSyncPromise = null;
const googleDriveFolderCache = new Map();
const pendingStatusSheetSyncs = new Map();

function getGoogleApiErrorMessage(message, serviceLabel = 'Google API') {
  const raw = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (/exportSizeLimitExceeded|too large to be exported|file is too large/i.test(raw)) {
    return 'File Google Sheet quá lớn nên không thể đọc ảnh trực tiếp.';
  }
  if (/SERVICE_DISABLED|has not been used in project|API .* disabled/i.test(raw)) {
    return `${serviceLabel} đang bị tắt. Hãy bật dịch vụ Google tương ứng rồi thử lại.`;
  }
  if (/permission|not have access|does not have permission|insufficient permissions/i.test(raw)) {
    return `Service Account chưa được cấp quyền truy cập ${serviceLabel}.`;
  }
  return `${serviceLabel} không thể xử lý yêu cầu lúc này.`;
}

function getSafeErrorMessage(error, fallback = 'Không thể hoàn tất yêu cầu.') {
  const text = String(error?.message ?? error ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (/exportSizeLimitExceeded|too large to be exported|file is too large/i.test(text)) {
    return 'File Google Sheet quá lớn nên không thể đọc ảnh trực tiếp.';
  }
  if (/^\s*[{[]/.test(text) || /"(?:error|errors|code|message)"\s*:/i.test(text) || /API trả về lỗi \d+/i.test(text)) {
    return fallback;
  }
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

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

function normalizeGoogleDriveFolders(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed)
    .map(([field, folder]) => [String(field).trim(), String(folder ?? '').trim()])
    .filter(([field, folder]) => field && folder));
}

function normalizeErrorSheetUrls(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed)
    .map(([field, url]) => [String(field).trim(), normalizeGoogleSheetUrl(url)])
    .filter(([field, url]) => field && url));
}

function normalizeChecklists(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  return Object.fromEntries(Object.entries(parsed)
    .map(([field, items]) => {
      const normalizedField = String(field).trim();
      if (!normalizedField || !Array.isArray(items)) return [normalizedField, []];
      const normalizedItems = items.map((item, index) => {
        const rawUrl = typeof item === 'string' ? item : item?.url ?? item?.link ?? '';
        const url = normalizeGoogleSheetUrl(rawUrl);
        if (!url) return null;
        const name = String(typeof item === 'object' ? item?.name ?? item?.title ?? '' : '').trim() || `Checklist ${index + 1}`;
        const id = String(typeof item === 'object' ? item?.id ?? '' : '').trim() || `${normalizedField}-${index + 1}`;
        return { id: id.slice(0, 100), name: name.slice(0, 150), url };
      }).filter(Boolean);
      return [normalizedField, normalizedItems];
    })
    .filter(([field]) => field));
}

function getConfiguredErrorSheetUrl(errorSheetUrls, field) {
  const fieldName = String(field ?? '').trim();
  if (!fieldName) return '';
  const exact = errorSheetUrls?.[fieldName];
  if (exact) return String(exact).trim();
  const match = Object.entries(errorSheetUrls || {})
    .find(([name]) => String(name).trim().toLowerCase() === fieldName.toLowerCase());
  return String(match?.[1] ?? '').trim();
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
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ].join(' '),
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
    response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    }, GOOGLE_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Google OAuth phản hồi quá lâu. Hãy kiểm tra Internet hoặc proxy của máy chạy backend.');
    }
    throw new Error('Không thể kết nối Google OAuth. Hãy kiểm tra Internet của máy chạy backend.');
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(getGoogleApiErrorMessage(message, 'Google OAuth'));
  }

  const payload = await response.json();
  googleAccessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
  };
  return googleAccessTokenCache.token;
}

async function googleSheetsRequest(path, options = {}) {
  const token = await getGoogleAccessToken();
  let response;
  try {
    response = await fetchWithTimeout(`https://sheets.googleapis.com/v4/${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    }, GOOGLE_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Google Sheets API phản hồi quá lâu. Hãy kiểm tra Internet hoặc proxy của máy chạy backend.');
    }
    throw new Error('Không thể kết nối Google Sheets API. Hãy kiểm tra Internet của máy chạy backend.');
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(getGoogleApiErrorMessage(message, 'Google Sheets API'));
  }
  if (response.status === 204) return {};
  return response.json();
}

async function googleDriveRequest(path, options = {}) {
  const token = await getGoogleAccessToken();
  let response;
  try {
    response = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    }, GOOGLE_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Google Drive API phản hồi quá lâu. Hãy kiểm tra Internet hoặc proxy của máy chạy backend.');
    }
    throw new Error('Không thể kết nối Google Drive API. Hãy kiểm tra Internet của máy chạy backend.');
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(getGoogleApiErrorMessage(message, 'Google Drive API'));
  }
  if (response.status === 204) return {};
  return response.json();
}

async function googleDriveBinaryRequest(path) {
  const token = await getGoogleAccessToken();
  let response;
  try {
    response = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    }, GOOGLE_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Google Drive API phản hồi quá lâu khi tải ảnh từ Google Sheet.');
    }
    throw new Error('Không thể tải ảnh trực tiếp từ Google Sheet qua Google Drive API.');
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(getGoogleApiErrorMessage(message, 'Google Sheet'));
  }
  return Buffer.from(await response.arrayBuffer());
}

async function googleSheetTabExportRequest(spreadsheetId, sheetId) {
  const token = await getGoogleAccessToken();
  const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=xlsx&gid=${encodeURIComponent(sheetId)}`;
  let response;
  try {
    response = await fetchWithTimeout(exportUrl, {
      headers: { Authorization: `Bearer ${token}` }
    }, GOOGLE_REQUEST_TIMEOUT_MS);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Google Sheet phản hồi quá lâu khi tải ảnh trực tiếp.');
    }
    throw new Error('Không thể tải trực tiếp tab Google Sheet để đọc ảnh.');
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(getGoogleApiErrorMessage(message, 'Google Sheet'));
  }
  const workbookBuffer = Buffer.from(await response.arrayBuffer());
  if (workbookBuffer.subarray(0, 2).toString('utf8') !== 'PK') {
    throw new Error('Google Sheet không trả về file Excel hợp lệ để đọc ảnh.');
  }
  return workbookBuffer;
}

async function deleteGoogleDriveFile(fileId) {
  const token = await getGoogleAccessToken();
  const response = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  }, GOOGLE_REQUEST_TIMEOUT_MS);
  if (!response.ok && response.status !== 404) {
    const message = await response.text();
    throw new Error(getGoogleApiErrorMessage(message, 'Google Drive'));
  }
}

function escapeGoogleDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findGoogleDriveFolders(folderName, parentId = '') {
  const normalizedFolderName = String(folderName ?? '').trim();
  const normalizedParentId = String(parentId ?? '').trim();
  if (!normalizedFolderName) return [];

  const cacheKey = `folders::${normalizedParentId || 'root'}::${normalizedFolderName}`;
  const now = Date.now();
  const cached = googleDriveFolderCache.get(cacheKey);
  if (cached && now - cached.checkedAt < GOOGLE_DRIVE_FOLDER_CACHE_TTL_MS) return cached.folders;

  const parentFilter = normalizedParentId
    ? ` and '${escapeGoogleDriveQueryValue(normalizedParentId)}' in parents`
    : '';
  const queryParams = {
    q: `name = '${escapeGoogleDriveQueryValue(normalizedFolderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentFilter}`,
    spaces: 'drive',
    // Keep the default `user` corpus so folders shared from My Drive are
    // searchable. includeItemsFromAllDrives still keeps Shared Drive support.
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '100',
    fields: 'nextPageToken,files(id,name,webViewLink,driveId,parents)'
  };
  const folders = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ ...queryParams, ...(pageToken ? { pageToken } : {}) });
    const payload = await googleDriveRequest(`files?${query.toString()}`);
    folders.push(...(payload.files || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  googleDriveFolderCache.set(cacheKey, { checkedAt: now, folders });
  return folders;
}

async function findGoogleDriveFolder(folderName, parentId = '') {
  const folders = await findGoogleDriveFolders(folderName, parentId);
  if (!folders?.length) return null;
  if (parentId) return folders[0];
  return folders.find((candidate) => candidate.driveId && candidate.parents?.includes(candidate.driveId)) || folders[0];
}

async function findDirectGoogleDriveFolders(parentId) {
  const normalizedParentId = String(parentId ?? '').trim();
  if (!normalizedParentId) return [];
  const cacheKey = `children::${normalizedParentId}`;
  const now = Date.now();
  const cached = googleDriveFolderCache.get(cacheKey);
  if (cached && now - cached.checkedAt < GOOGLE_DRIVE_FOLDER_CACHE_TTL_MS) return cached.folders;

  const queryParams = {
    q: `'${escapeGoogleDriveQueryValue(normalizedParentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    spaces: 'drive',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '1000',
    fields: 'nextPageToken,files(id,name,webViewLink,driveId,parents)'
  };
  const folders = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ ...queryParams, ...(pageToken ? { pageToken } : {}) });
    const payload = await googleDriveRequest(`files?${query.toString()}`);
    folders.push(...(payload.files || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  googleDriveFolderCache.set(cacheKey, { checkedAt: now, folders });
  return folders;
}

function normalizeDriveFolderSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gi, 'd')
    // Keep Unicode letters and numbers so Korean, Chinese, Japanese and
    // other non-Latin folder names remain searchable.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function findDriveFolderBySeriesName(folders, seriesName) {
  const target = normalizeDriveFolderSearchText(seriesName);
  if (!target) return null;
  const matches = folders
    .map((folder) => ({ folder, name: normalizeDriveFolderSearchText(folder.name) }))
    .filter(({ name }) => name === target || name.includes(target))
    .sort((left, right) => {
      const score = (name) => name === target
        ? 3
        : name.startsWith(target) || name.includes(` ${target}`)
          ? 2
          : 1;
      return score(right.name) - score(left.name) || left.name.length - right.name.length;
    });
  return matches[0]?.folder || null;
}

async function findGoogleDriveFolderUrl(seriesId, field, googleDriveFolders = {}, seriesName = '') {
  const seriesFolderName = String(seriesId ?? '').trim();
  const fieldName = String(field ?? '').trim();
  const rootFolderName = getConfiguredDriveRootFolder(fieldName, googleDriveFolders);
  if (!seriesFolderName) return '';

  const cacheKey = `url::${fieldName}::${rootFolderName}::${seriesFolderName}::${normalizeDriveFolderSearchText(seriesName)}`;

  const now = Date.now();
  const cached = googleDriveFolderCache.get(cacheKey);
  if (cached && now - cached.checkedAt < GOOGLE_DRIVE_FOLDER_CACHE_TTL_MS) return cached.url;

  let folder = null;
  if (rootFolderName) {
    const rootFolders = await findGoogleDriveFolders(rootFolderName);
    const prioritizedRoots = [...(rootFolders || [])].sort((left, right) => {
      const leftIsSharedDriveRoot = left.driveId && left.parents?.includes(left.driveId) ? 1 : 0;
      const rightIsSharedDriveRoot = right.driveId && right.parents?.includes(right.driveId) ? 1 : 0;
      return rightIsSharedDriveRoot - leftIsSharedDriveRoot;
    });
    // Folder names are not globally unique. Try every configured root with
    // this name and keep the one that actually contains the requested ID.
    for (const rootCandidate of prioritizedRoots) {
      folder = await findGoogleDriveFolder(seriesFolderName, rootCandidate.id);
      if (!folder && seriesName) {
        folder = findDriveFolderBySeriesName(
          await findDirectGoogleDriveFolders(rootCandidate.id),
          seriesName
        );
      }
      if (folder) break;
    }
  } else {
    folder = await findGoogleDriveFolder(seriesFolderName);
    if (!folder && seriesName) {
      // When no field root is configured, also allow the folder to be named
      // after the series title instead of the numeric series ID.
      const namedFolders = await findGoogleDriveFolders(seriesName);
      folder = findDriveFolderBySeriesName(namedFolders, seriesName) || namedFolders[0] || null;
    }
  }
  const url = folder?.webViewLink || (folder?.id ? `https://drive.google.com/drive/folders/${folder.id}` : '');
  googleDriveFolderCache.set(cacheKey, { checkedAt: now, url });
  return url;
}

function googleDriveLookupKey(field, seriesId) {
  return `${String(field ?? '').trim()}::${String(seriesId ?? '').trim()}`;
}

function getConfiguredDriveRootFolder(field, googleDriveFolders = {}) {
  const fieldName = String(field ?? '').trim();
  const exactFolder = googleDriveFolders[fieldName];
  if (exactFolder) return String(exactFolder).trim();
  const matchingEntry = Object.entries(googleDriveFolders)
    .find(([configuredField]) => String(configuredField).trim().toLowerCase() === fieldName.toLowerCase());
  return String(matchingEntry?.[1] ?? '').trim();
}

async function enrichRowsWithGoogleDriveLinks(rows, lookupRows = rows, googleDriveFolders = {}) {
  const lookups = [...new Map(lookupRows
    .filter(({ data }) => !isHttpUrl(data.urlSeries) || Boolean(getConfiguredDriveRootFolder(data.type, googleDriveFolders)))
    .map(({ data }) => {
      const field = String(data.type ?? '').trim();
      const seriesId = String(data.seriesId ?? '').trim();
      const seriesName = String(data.seriesName ?? '').trim();
      return [googleDriveLookupKey(field, seriesId), { field, seriesId, seriesName }];
    })
    .filter(([, lookup]) => lookup.seriesId)).values()];
  if (lookups.length === 0) return { rows, linked: 0, missing: 0, error: '' };

  let firstError = '';
  const lookupResults = await runWithConcurrency(lookups, async ({ field, seriesId, seriesName }) => {
    if (firstError) return { seriesId, url: '', error: firstError };
    try {
      return { field, seriesId, key: googleDriveLookupKey(field, seriesId), url: await findGoogleDriveFolderUrl(seriesId, field, googleDriveFolders, seriesName), error: '' };
    } catch (error) {
      firstError = error.message || 'Không thể tìm folder trên Google Drive.';
      return { field, seriesId, key: googleDriveLookupKey(field, seriesId), url: '', error: firstError };
    }
  });
  const urlsByLookupKey = new Map(lookupResults.map(({ key, field, seriesId, url }) => [key || googleDriveLookupKey(field, seriesId), url]));
  let linked = 0;
  const enrichedRows = rows.map((entry) => {
    const hasConfiguredRoot = Boolean(getConfiguredDriveRootFolder(entry.data.type, googleDriveFolders));
    if (isHttpUrl(entry.data.urlSeries) && !hasConfiguredRoot) return entry;
    const driveUrl = urlsByLookupKey.get(googleDriveLookupKey(entry.data.type, entry.data.seriesId));
    if (driveUrl) linked += 1;
    // Once a root is configured, the Drive lookup is authoritative. Do not
    // keep a stale URL from an older global search when the scoped lookup is
    // missing or points to a different folder.
    if (hasConfiguredRoot) {
      return { ...entry, data: { ...entry.data, urlSeries: driveUrl || '' } };
    }
    if (!driveUrl) return entry;
    return { ...entry, data: { ...entry.data, urlSeries: driveUrl } };
  });
  const missing = lookupResults.filter(({ url, error }) => !url && !error).length;
  return { rows: enrichedRows, linked, missing, error: firstError };
}

async function enrichStoredDeadlineUrls(deadlines, googleDriveFolders = {}) {
  try {
    const entries = deadlines.map((data) => ({
      data: { ...data, urlSeries: normalizeUrlSeries(data.urlSeries) }
    }));
    const result = await enrichRowsWithGoogleDriveLinks(entries, entries, googleDriveFolders);
    const changedEntries = result.rows.filter(({ data }, index) => {
      const previousUrl = normalizeUrlSeries(deadlines[index]?.urlSeries);
      return data.urlSeries !== previousUrl;
    });

    await runWithConcurrency(changedEntries, async ({ data }) => {
      try {
        await updateRow(
          'deadlines',
          { seriesId: data.seriesId, chapterNumber: data.chapterNumber },
          { urlSeries: isHttpUrl(data.urlSeries) ? data.urlSeries : null },
          ['urlSeries']
        );
      } catch (error) {
        // A failed automatic URL write must not prevent the deadline table
        // from loading. The link can be retried on the next refresh.
        console.error(`Could not save Drive URL for ${data.seriesId}:`, error.message);
      }
    });

    return result.rows.map(({ data }) => data);
  } catch (error) {
    // Drive access is an optional enrichment. Keep the main deadline request
    // usable when credentials, permissions, or the Drive API are unavailable.
    console.error('Automatic Google Drive URL lookup failed:', error.message);
    return deadlines;
  }
}

function parseGoogleSheetReference(sheetUrl) {
  const parsed = new URL(sheetUrl);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw validationError('Không tìm thấy Spreadsheet ID trong link Google Sheet.');
  return {
    spreadsheetId: decodeURIComponent(match[1]),
    gid: parsed.searchParams.get('gid') ?? new URLSearchParams(parsed.hash.slice(1)).get('gid')
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
  // values.get() does not include row visibility. Read the grid metadata as
  // well so filtered/manual-hidden rows can be excluded from synchronization.
  const query = new URLSearchParams({
    includeGridData: 'true',
    ranges: range,
    fields: 'sheets(merges,data(startRow,rowMetadata(hiddenByFilter,hiddenByUser),rowData/values(formattedValue,userEnteredValue,effectiveValue,dataValidation(condition(type,values(userEnteredValue)),showCustomUi))))'
  });
  const payload = await googleSheetsRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}?${query.toString()}`
  );
  const data = payload.sheets?.[0]?.data?.[0] || {};
  const cellData = (data.rowData || []).map((row) => row.values || []);
  const values = cellData.map((row) => row.map((cell) => cell.formattedValue ?? ''));
  const hiddenRows = new Set(
    (data.rowMetadata || [])
      .map((metadata, index) => (
        metadata?.hidden === true || metadata?.hiddenByFilter === true || metadata?.hiddenByUser === true ? index : null
      ))
      .filter((index) => index !== null)
  );
  return { values, cellData, hiddenRows, merges: payload.sheets?.[0]?.merges || [], startRow: Number(data.startRow || 0) };
}

function parseGoogleSheetA1Range(range) {
  const reference = String(range ?? '').trim();
  const bangIndex = reference.indexOf('!');
  const sheetTitle = bangIndex === -1 ? reference : reference.slice(0, bangIndex);
  const body = bangIndex === -1 ? '' : reference.slice(bangIndex + 1);
  const startReference = body.split(':')[0] || 'A1';
  const match = startReference.match(/^([A-Za-z]+)?(\d+)?$/);
  const startColumn = match?.[1] ? googleSheetColumnToIndex(match[1]) : 0;
  const startRow = match?.[2] ? Math.max(0, Number(match[2]) - 1) : 0;
  return { sheetTitle: sheetTitle.replace(/^'|'$/g, "").replace(/''/g, "'"), startColumn, startRow };
}

function googleSheetColumnToIndex(value) {
  return String(value || '').toUpperCase().split('').reduce((total, character) => (
    total * 26 + character.charCodeAt(0) - 64
  ), 0) - 1;
}

function googleSheetIndexToColumn(index) {
  let current = Math.max(0, Number(index) || 0) + 1;
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function quoteGoogleSheetTitle(title) {
  return `'${String(title ?? '').replace(/'/g, "''")}'`;
}

async function readGoogleSheetTabs(settings) {
  const { spreadsheetId, gid } = parseGoogleSheetReference(settings.googleSheetUrl);
  const metadata = await getGoogleSheetMetadata(spreadsheetId);
  const sheets = metadata.sheets || [];
  const configuredTabs = Object.entries(normalizeGoogleSheetTabs(settings.googleSheetTabs));
  if (configuredTabs.length > 0) {
    const results = await Promise.all(configuredTabs.map(async ([field, tabReference]) => {
      const reference = String(tabReference ?? '').trim();
      const bangIndex = reference.indexOf('!');
      const sheetTitle = bangIndex === -1 ? reference : reference.slice(0, bangIndex);
      const selectedSheet = sheets.find((sheet) => String(sheet.properties?.title).toLowerCase() === sheetTitle.toLowerCase());
      if (!selectedSheet) {
        return { field, missingTab: sheetTitle };
      }
      const range = resolveGoogleSheetRange(tabReference, sheets);
      return {
        field,
        range,
        sheetId: selectedSheet.properties?.sheetId,
        sheetTitle: selectedSheet.properties?.title,
        rangeMeta: parseGoogleSheetA1Range(range),
        ...(await readGoogleSheetValues(spreadsheetId, range))
      };
    }));
    const tabs = results.filter((result) => !result.missingTab);
    const missingTabs = results.filter((result) => result.missingTab);
    if (tabs.length === 0) {
      throw new Error(`Không tìm thấy tab Google Sheet đã cấu hình: ${missingTabs.map(({ missingTab }) => `"${missingTab}"`).join(', ')}.`);
    }
    return { tabs, missingTabs };
  }

  const selectedSheet = gid
    ? sheets.find((sheet) => String(sheet.properties?.sheetId) === String(gid))
    : sheets[0];
  const range = settings.googleSheetRange || selectedSheet?.properties?.title;
  if (!range) throw new Error('Không tìm thấy tab trong Google Sheet.');
  const resolvedRange = range.includes('!') ? range : resolveGoogleSheetRange(range, sheets);
  const rangeSheetTitle = parseGoogleSheetA1Range(resolvedRange).sheetTitle;
  const rangeSheet = sheets.find((sheet) => String(sheet.properties?.title).toLowerCase() === rangeSheetTitle.toLowerCase()) || selectedSheet;
  return {
    tabs: [{
      field: null,
      range: resolvedRange,
      sheetId: rangeSheet?.properties?.sheetId,
      sheetTitle: rangeSheet?.properties?.title,
      rangeMeta: parseGoogleSheetA1Range(resolvedRange),
      ...(await readGoogleSheetValues(spreadsheetId, resolvedRange))
    }],
    missingTabs: []
  };
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
  statusRaw: ['statusraw', 'rawstatus', 'trangthairaw', 'trangthai', 'file'],
  status: ['status', 'taskstatus', 'trangthaicodinh'],
  urlSeries: ['urlseries', 'seriesurl', 'url', 'link', 'linktruyen'],
  fIld: ['fild', 'freelancerid', 'freelancer', 'freelancername', 'nguoiduocgiao'],
  assignedAdminId: ['assignedadminid', 'adminid', 'adminassigneeid', 'adminassignee', 'adminnguoigiao'],
  qcId: ['qcid', 'qc', 'qcname', 'nguoiqc', 'qcincharge'],
  difficulty: ['difficulty', 'level', 'dokho', 'mucdo'],
  price: ['price', 'priceperchapter', 'dongia', 'rate'],
  feedback: ['feedback', 'note', 'ghichu', 'phanhoi'],
  late: ['late', 'latetime', 'delay', 'tre', 'quahan', 'muclate'],
  completionPercent: ['completionpercent', 'percent', 'progress', 'phantramhoanthanh', 'hoanthanh', '100'],
  paymentApproved: ['paymentapproved', 'payment', 'thanhtoan', 'duoc thanhtoan', 'paid']
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
  const seriesId = getSheetValue(row, headerIndex, 'seriesId', fieldOverride);
  const chapterNumber = getSheetValue(row, headerIndex, 'chapterNumber');
  // Tabs contain instructions, price tables, and helper rows in addition to
  // deadline records. A row without either key is not a deadline row and must
  // not block reconciliation of deleted deadlines.
  return !seriesId && !chapterNumber;
}

function isIncompleteGoogleSheetRow(row, headerIndex, fieldOverride = null) {
  const seriesId = getSheetValue(row, headerIndex, 'seriesId', fieldOverride);
  const chapterNumber = getSheetValue(row, headerIndex, 'chapterNumber');
  // New assignments often have only the ID, chapter, and deadline filled in.
  // Difficulty/price can be completed later from the web, so they must not
  // make an otherwise valid deadline disappear from the import.
  return !seriesId || !chapterNumber;
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

function parseImportedChapter(value, rowNumber) {
  const chapter = String(value ?? '').trim();
  if (!chapter) throw validationError(`Dòng ${rowNumber}: thiếu chapter.`);
  if (chapter.length > 100) throw validationError(`Dòng ${rowNumber}: chapter tối đa 100 ký tự.`);
  return chapter;
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

function parseImportedBoolean(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return false;
  return ['true', '1', 'yes', 'y', 'done', 'paid', 'đã thanh toán', 'đã duyệt'].includes(text);
}

function parseImportedDate(value, label, rowNumber, { endOfDay = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 10_000 && serial < 100_000) {
      const serialDate = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return endOfDay
        ? normalizeDeadlineEndOfDayFromParts(serialDate.getUTCFullYear(), serialDate.getUTCMonth() + 1, serialDate.getUTCDate(), `Dòng ${rowNumber}: ${label}`)
        : serialDate.toISOString();
    }
  }
  const vietnameseDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?$/);
  const shortDate = text.match(/^(\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):?(\d{2})?(?::?(\d{2}))?)?$/);
  if (endOfDay && vietnameseDate) {
    return normalizeDeadlineEndOfDayFromParts(
      Number(vietnameseDate[3]),
      Number(vietnameseDate[2]),
      Number(vietnameseDate[1]),
      `Dòng ${rowNumber}: ${label}`
    );
  }
  if (endOfDay && shortDate) {
    return normalizeDeadlineEndOfDayFromParts(
      new Date().getFullYear(),
      Number(shortDate[2]),
      Number(shortDate[1]),
      `Dòng ${rowNumber}: ${label}`
    );
  }
  const parsed = vietnameseDate
    ? new Date(Number(vietnameseDate[3]), Number(vietnameseDate[2]) - 1, Number(vietnameseDate[1]), Number(vietnameseDate[4] || 0), Number(vietnameseDate[5] || 0), Number(vietnameseDate[6] || 0))
    : shortDate
      ? new Date(new Date().getFullYear(), Number(shortDate[2]) - 1, Number(shortDate[1]), Number(shortDate[3] || 0), Number(shortDate[4] || 0), Number(shortDate[5] || 0))
      : new Date(text);
  if (Number.isNaN(parsed.getTime())) throw validationError(`Dòng ${rowNumber}: ${label} không hợp lệ.`);
  return endOfDay ? normalizeDeadlineDueDate(parsed.toISOString(), `Dòng ${rowNumber}: ${label}`) : parsed.toISOString();
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

function getSheetDeadlineKey(row, headerIndex, fieldOverride = null) {
  const seriesId = Number(String(getSheetValue(row, headerIndex, 'seriesId', fieldOverride)).replace(/,/g, '').trim());
  const chapterNumber = String(getSheetValue(row, headerIndex, 'chapterNumber')).trim();
  if (!Number.isInteger(seriesId) || seriesId < 0 || !chapterNumber || chapterNumber.length > 100) return null;
  return `${seriesId}:${chapterNumber}`;
}

function buildImportedDeadline(row, headerIndex, fields, prices, freelancers, qcs, rowNumber, fieldOverride = null) {
  const seriesIdLabel = normalizeSheetHeader(fieldOverride) === 'latin' ? 'AZ ID' : 'seriesId';
  const seriesId = parseImportedInteger(getSheetValue(row, headerIndex, 'seriesId', fieldOverride), seriesIdLabel, rowNumber, { required: true });
  const chapterNumber = parseImportedChapter(getSheetValue(row, headerIndex, 'chapterNumber'), rowNumber);
  const type = fieldOverride || normalizeImportedField(getSheetValue(row, headerIndex, 'type'), fields, rowNumber);
  const importedPrice = parseImportedMoney(getSheetValue(row, headerIndex, 'price'), 'Price per chapter', rowNumber);
  const difficultyFromSheet = getSheetValue(row, headerIndex, 'difficulty');
  const difficulty = difficultyFromSheet || (importedPrice !== null ? 'Imported' : null);
  const endTask = parseImportedDate(getSheetValue(row, headerIndex, 'endTask'), 'endTask', rowNumber, { endOfDay: true });
  const submittedAtFromSheet = parseImportedDate(getSheetValue(row, headerIndex, 'submittedAt'), 'submittedAt', rowNumber);
  const rawStatus = getSheetValue(row, headerIndex, 'statusRaw') || getSheetValue(row, headerIndex, 'status') || 'Đang thực hiện';
  const status = normalizeImportedStatus(getSheetValue(row, headerIndex, 'status') || rawStatus);
  const submittedAt = status === 'submitted' ? (submittedAtFromSheet || new Date().toISOString()) : submittedAtFromSheet;
  const configuredPrice = difficulty
    ? prices.find((item) => String(item.field).toLowerCase() === type.toLowerCase() && String(item.difficulty).toLowerCase() === difficulty.toLowerCase())
    : null;
  const price = importedPrice ?? configuredPrice?.price ?? null;
  const completionText = getSheetValue(row, headerIndex, 'completionPercent');
  const parsedCompletionPercent = completionText === '' ? 100 : Number(completionText.replace('%', '').trim());
  // A value of 100 written into a Sheet cell formatted as Percent is displayed
  // as 10000%. Accept that representation as the intended 100% value while
  // still rejecting genuinely invalid completion values.
  const completionPercent = /%/.test(completionText) && parsedCompletionPercent > 200
    ? parsedCompletionPercent / 100
    : parsedCompletionPercent;
  if (!Number.isInteger(completionPercent) || completionPercent < 0 || completionPercent > 200) {
    throw validationError(`Dòng ${rowNumber}: completionPercent phải là số nguyên từ 0 đến 200.`);
  }
  const fIld = resolveImportedReference(getSheetValue(row, headerIndex, 'fIld'), freelancers, ['fIld', 'fId', 'id'], ['name', 'email']);
  const assignedAdminId = parseImportedInteger(getSheetValue(row, headerIndex, 'assignedAdminId'), 'assignedAdminId', rowNumber);
  const qcId = resolveImportedReference(getSheetValue(row, headerIndex, 'qcId'), qcs, ['qcId', 'id'], ['name', 'email']);
  const lateHeaderIndex = getGoogleSheetHeaderIndex(headerIndex, 'late', fieldOverride);
  const paymentHeaderIndex = getGoogleSheetHeaderIndex(headerIndex, 'paymentApproved', fieldOverride);
  return {
    seriesId,
    chapterNumber,
    endTask,
    ...(submittedAt ? { submittedAt } : {}),
    seriesName: nullableText(getSheetValue(row, headerIndex, 'seriesName')),
    type,
    statusRaw: nullableText(rawStatus) || 'Đang thực hiện',
    status,
    urlSeries: normalizeUrlSeries(getSheetValue(row, headerIndex, 'urlSeries')),
    fIld,
    assignedAdminId,
    qcId,
    difficulty,
    feedback: nullableText(getSheetValue(row, headerIndex, 'feedback')),
    ...(lateHeaderIndex === undefined ? {} : { late: normalizeLateValue(getSheetValue(row, headerIndex, 'late')) }),
    completionPercent,
    price,
    receivePrice: calculateReceivePrice(price, completionPercent),
    ...(paymentHeaderIndex === undefined
      ? {}
      : { paymentApproved: parseImportedBoolean(getSheetValue(row, headerIndex, 'paymentApproved')) })
  };
}

function normalizeSyncValue(value, column) {
  if (value === null || value === undefined || value === '') return '';
  if (['endTask', 'submittedAt'].includes(column)) {
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return String(timestamp);
  }
  if (['seriesId', 'fIld', 'assignedAdminId', 'qcId', 'price', 'receivePrice', 'completionPercent'].includes(column)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return String(numeric);
  }
  return String(value).trim();
}

function hasDeadlineSheetChanges(current, imported, columns) {
  return columns.some((column) => normalizeSyncValue(current[column], column) !== normalizeSyncValue(imported[column], column));
}

const GOOGLE_SHEET_DEADLINE_COLUMNS = [
  'seriesId', 'chapterNumber', 'endTask', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status',
  'urlSeries', 'fIld', 'assignedAdminId', 'qcId', 'difficulty', 'price', 'receivePrice',
  'feedback', 'late', 'completionPercent', 'paymentApproved'
];

function getGoogleSheetHeaderIndex(headerIndex, key, fieldOverride = null) {
  const aliases = key === 'seriesId' && normalizeSheetHeader(fieldOverride) === 'latin'
    ? ['azid']
    : googleSheetHeaderAliases[key] || [];
  return aliases.map((alias) => headerIndex.get(normalizeSheetHeader(alias))).find((value) => value !== undefined);
}

function getGoogleSheetTabSnapshot(tab, fields) {
  const headerRowIndex = findGoogleSheetHeaderRow(tab.values);
  const headers = tab.values[headerRowIndex].map(normalizeSheetHeader);
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const fieldOverride = tab.field ? normalizeImportedField(tab.field, fields, 1) : null;
  const startRow = Number(tab.startRow ?? tab.rangeMeta?.startRow ?? 0);
  const startColumn = Number(tab.rangeMeta?.startColumn ?? 0);
  return { ...tab, headerRowIndex, headerIndex, fieldOverride, startRow, startColumn };
}

function getImportedDeadlineCompleteness(entry) {
  if (!entry?.sourceRow || !entry.headerIndex) return 0;
  return GOOGLE_SHEET_DEADLINE_COLUMNS.reduce((score, key) => {
    if (key === 'type' && entry.fieldOverride) return score + 1;
    const columnIndex = getGoogleSheetHeaderIndex(entry.headerIndex, key, entry.fieldOverride);
    const value = columnIndex === undefined ? '' : entry.sourceRow[columnIndex];
    return String(value ?? '').trim() ? score + 1 : score;
  }, 0);
}

function findGoogleSheetRow(tab, seriesId, chapterNumber) {
  let bestMatch = null;
  let bestCompleteness = -1;
  for (let index = tab.headerRowIndex + 1; index < tab.values.length; index += 1) {
    const row = tab.values[index] || [];
    if (isDecorativeGoogleSheetRow(row, tab.headerIndex, tab.fieldOverride)) continue;
    const currentSeriesId = getSheetValue(row, tab.headerIndex, 'seriesId', tab.fieldOverride);
    const currentChapterNumber = getSheetValue(row, tab.headerIndex, 'chapterNumber');
    if (Number(currentSeriesId) === Number(seriesId) && String(currentChapterNumber).trim() === String(chapterNumber).trim()) {
      const completeness = getSheetRowCompleteness(row, tab.headerIndex, tab.fieldOverride);
      if (completeness < bestCompleteness) continue;
      bestCompleteness = completeness;
      bestMatch = {
        row,
        rowIndex: index,
        rowNumber: tab.startRow + index + 1
      };
    }
  }
  return bestMatch;
}

function getSheetRowCompleteness(row, headerIndex, fieldOverride = null) {
  return GOOGLE_SHEET_DEADLINE_COLUMNS.reduce((score, key) => {
    if (key === 'type' && fieldOverride) return score + 1;
    const columnIndex = getGoogleSheetHeaderIndex(headerIndex, key, fieldOverride);
    const value = columnIndex === undefined ? '' : row[columnIndex];
    return String(value ?? '').trim() ? score + 1 : score;
  }, 0);
}

function formatGoogleSheetDate(value, { dateOnly = false } = {}) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (dateOnly) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: DEADLINE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.day}/${values.month}/${values.year}`;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return hours || minutes
    ? `${day}/${month}/${year} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : `${day}/${month}/${year}`;
}

function isRawStatusChecked(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'done', 'completed', 'hoàn thành', 'đã hoàn thành', 'đã up raw'].includes(normalized);
}

function isGoogleSheetCheckboxColumn(tab, columnIndex) {
  const header = [...tab.headerIndex.entries()].find(([, index]) => index === columnIndex)?.[0] || '';
  if (['file', 'checkbox', 'checked', 'statusraw'].includes(header)) return true;
  return tab.values
    .slice(tab.headerRowIndex + 1)
    .map((row) => String(row?.[columnIndex] ?? '').trim().toLowerCase())
    .some((value) => value === 'true' || value === 'false');
}

function normalizeStatusOption(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['doing', 'đang thực hiện', 'đang làm'].includes(normalized)) return 'doing';
  if (['submitted', 'đã gửi', 'chờ qc'].includes(normalized)) return 'submitted';
  if (['checking', 'đang kiểm tra'].includes(normalized)) return 'checking';
  if (['fixing', 'đang sửa'].includes(normalized)) return 'fixing';
  if (['done', 'hoàn thành', 'completed', 'complete'].includes(normalized)) return 'done';
  return '';
}

function getGoogleSheetStatusCondition(tab, columnIndex, rowNumber = null) {
  const rowIndex = rowNumber === null || rowNumber === undefined
    ? -1
    : rowNumber - tab.startRow - 1;
  const rowCondition = rowIndex >= 0
    ? tab.cellData?.[rowIndex]?.[columnIndex]?.dataValidation?.condition
    : null;
  return rowCondition || tab.cellData
    ?.map((row) => row?.[columnIndex]?.dataValidation?.condition)
    .find(Boolean) || null;
}

function getGoogleSheetConditionValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return String(value.userEnteredValue ?? value.stringValue ?? value.numberValue ?? '').trim();
}

function getGoogleSheetStatusOptions(tab, columnIndex, rowNumber = null) {
  const conditions = [];
  const rowIndex = rowNumber === null || rowNumber === undefined
    ? -1
    : rowNumber - tab.startRow - 1;
  const rowCondition = rowIndex >= 0
    ? tab.cellData?.[rowIndex]?.[columnIndex]?.dataValidation?.condition
    : null;
  if (rowCondition) conditions.push(rowCondition);
  (tab.cellData || []).forEach((row) => {
    const condition = row?.[columnIndex]?.dataValidation?.condition;
    if (condition) conditions.push(condition);
  });

  const options = [];
  conditions.forEach((condition) => {
    if (condition.type !== 'ONE_OF_LIST') return;
    (condition.values || []).forEach((value) => {
      const option = getGoogleSheetConditionValue(value);
      if (option && !options.includes(option)) options.push(option);
    });
  });

  // ONE_OF_RANGE dropdowns are resolved once before a write and stored by
  // hydrateGoogleSheetStatusOptions. Keep the cell-level list above so a
  // row-specific dropdown always takes precedence over a column fallback.
  const hydratedOptions = tab.statusOptionsByColumn?.get?.(columnIndex)
    || tab.statusOptionsByColumn?.get?.(String(columnIndex))
    || [];
  hydratedOptions.forEach((option) => {
    if (option && !options.includes(option)) options.push(option);
  });
  return options;
}

async function hydrateGoogleSheetStatusOptions(spreadsheetId, tab) {
  const columnIndex = getGoogleSheetHeaderIndex(tab.headerIndex, 'status', tab.fieldOverride);
  if (columnIndex === undefined) return tab;
  const conditions = (tab.cellData || [])
    .map((row) => row?.[columnIndex]?.dataValidation?.condition)
    .filter((condition) => condition?.type === 'ONE_OF_RANGE');
  const rangeReferences = [...new Set(conditions
    .flatMap((condition) => condition.values || [])
    .map((value) => getGoogleSheetConditionValue(value).replace(/^=/, '').trim())
    .filter(Boolean))];
  const values = await Promise.all(rangeReferences.map(async (range) => {
    const source = await readGoogleSheetValues(spreadsheetId, range);
    return source.values.flat().map((value) => String(value ?? '').trim()).filter(Boolean);
  }));
  const options = values.flat();
  if (!tab.statusOptionsByColumn) tab.statusOptionsByColumn = new Map();
  tab.statusOptionsByColumn.set(columnIndex, [...new Set(options)]);
  return tab;
}

function getGoogleSheetStatusValue(tab, rowNumber, row, columnIndex) {
  const status = normalizeStatusOption(row.status);
  if (!status) return row.status || '';

  const configuredOptions = getGoogleSheetStatusOptions(tab, columnIndex, rowNumber);
  const matchingOption = configuredOptions.find((option) => normalizeStatusOption(option) === status);
  if (matchingOption) return matchingOption;

  const rowIndex = rowNumber === null || rowNumber === undefined
    ? -1
    : rowNumber - tab.startRow - 1;
  const currentValue = rowIndex >= 0 ? tab.values[rowIndex]?.[columnIndex] : '';
  const condition = getGoogleSheetStatusCondition(tab, columnIndex, rowNumber);
  if (condition?.type === 'ONE_OF_LIST' || condition?.type === 'ONE_OF_RANGE') {
    throw new Error(`Không tìm thấy option "${status}" trong dropdown Status của ô ${tab.sheetTitle || 'Google Sheet'}!${googleSheetIndexToColumn(tab.startColumn + columnIndex)}${rowNumber || ''}.`);
  }
  if (/^[A-Z]/.test(String(currentValue || ''))) return status.charAt(0).toUpperCase() + status.slice(1);
  return status;
}

function getGoogleSheetCellValue(row, key, fieldOverride = null, asCheckbox = false, statusValue = null) {
  if (key === 'type' && fieldOverride) return fieldOverride;
  if (key === 'endTask') return formatGoogleSheetDate(row[key], { dateOnly: true });
  if (key === 'submittedAt') return formatGoogleSheetDate(row[key]);
  if (key === 'statusRaw' && asCheckbox) return isRawStatusChecked(row.statusRaw);
  if (key === 'status' && statusValue !== null) return statusValue;
  if (key === 'completionPercent') {
    const completionPercent = Number(row[key]);
    return Number.isFinite(completionPercent) ? `${completionPercent}%` : '';
  }
  if (key === 'paymentApproved') return Boolean(row[key]);
  if (key === 'late') return normalizeLateValue(row[key]);
  if (key === 'fIld') return row.fIld ?? row.fId ?? '';
  if (key === 'statusRaw') return row.statusRaw || row.status || '';
  if (key === 'urlSeries') return row.urlSeries || '';
  if (row[key] === null || row[key] === undefined) return '';
  return row[key];
}

function getGoogleSheetTargetTab(tabs, field) {
  const normalizedField = String(field ?? '').trim().toLowerCase();
  return tabs.find((tab) => tab.field && String(tab.field).trim().toLowerCase() === normalizedField)
    || (tabs.length === 1 && !tabs[0].field ? tabs[0] : null);
}

async function writeGoogleSheetCells(spreadsheetId, tab, rowNumber, row, columns = null) {
  const columnsToWrite = Array.isArray(columns)
    ? GOOGLE_SHEET_DEADLINE_COLUMNS.filter((key) => columns.includes(key))
    : GOOGLE_SHEET_DEADLINE_COLUMNS;
  const data = columnsToWrite
    .map((key) => {
      const columnIndex = getGoogleSheetHeaderIndex(tab.headerIndex, key, tab.fieldOverride);
      if (columnIndex === undefined) return null;
      const statusValue = key === 'status'
        ? getGoogleSheetStatusValue(tab, rowNumber, row, columnIndex)
        : null;
      return {
        range: `${quoteGoogleSheetTitle(tab.sheetTitle)}!${googleSheetIndexToColumn(tab.startColumn + columnIndex)}${rowNumber}`,
        values: [[getGoogleSheetCellValue(row, key, tab.fieldOverride, isGoogleSheetCheckboxColumn(tab, columnIndex), statusValue)]]
      };
    })
    .filter(Boolean);
  // An optional web-only column (for example Thanh toán) must not cause a
  // missing Sheet column to be created during an update.
  if (data.length === 0) return { skipped: true };
  return googleSheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: { valueInputOption: 'USER_ENTERED', data }
  });
}

function getGoogleSheetStatusRepair(tab, rowNumber, row, sourceRow) {
  const columnIndex = getGoogleSheetHeaderIndex(tab.headerIndex, 'status', tab.fieldOverride);
  if (columnIndex === undefined || !normalizeStatusOption(row?.status)) return null;
  const condition = getGoogleSheetStatusCondition(tab, columnIndex, rowNumber);
  if (!['ONE_OF_LIST', 'ONE_OF_RANGE'].includes(condition?.type)) return null;
  const currentValue = String(sourceRow?.[columnIndex] ?? '').trim();
  const expectedValue = getGoogleSheetStatusValue(tab, rowNumber, row, columnIndex);
  if (!expectedValue || expectedValue === currentValue) return null;
  return { columnIndex, currentValue, expectedValue };
}

async function repairGoogleSheetStatusCell(spreadsheetId, tab, rowNumber, row, sourceRow) {
  const repair = getGoogleSheetStatusRepair(tab, rowNumber, row, sourceRow);
  if (!repair) return false;
  await writeGoogleSheetCells(spreadsheetId, tab, rowNumber, row, ['status']);
  return true;
}

async function appendGoogleSheetRow(spreadsheetId, tab, row) {
  const mappedColumns = GOOGLE_SHEET_DEADLINE_COLUMNS
    .map((key) => getGoogleSheetHeaderIndex(tab.headerIndex, key, tab.fieldOverride))
    .filter((index) => index !== undefined);
  if (mappedColumns.length === 0) throw new Error(`Tab "${tab.sheetTitle}" chưa có cột dữ liệu để thêm dòng.`);
  const lastColumn = Math.max(...mappedColumns);
  const values = Array.from({ length: lastColumn + 1 }, () => '');
  GOOGLE_SHEET_DEADLINE_COLUMNS.forEach((key) => {
    const columnIndex = getGoogleSheetHeaderIndex(tab.headerIndex, key, tab.fieldOverride);
    if (columnIndex !== undefined) {
      const statusValue = key === 'status'
        ? getGoogleSheetStatusValue(tab, null, row, columnIndex)
        : null;
      values[columnIndex] = getGoogleSheetCellValue(
        row,
        key,
        tab.fieldOverride,
        isGoogleSheetCheckboxColumn(tab, columnIndex),
        statusValue
      );
    }
  });
  const startColumn = googleSheetIndexToColumn(tab.startColumn);
  const endColumn = googleSheetIndexToColumn(tab.startColumn + lastColumn);
  return googleSheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoteGoogleSheetTitle(tab.sheetTitle)}!${startColumn}:${endColumn}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: { majorDimension: 'ROWS', values: [values] }
  });
}

async function deleteGoogleSheetRow(spreadsheetId, tab, rowNumber) {
  if (tab.sheetId === undefined || tab.sheetId === null) throw new Error(`Không xác định được sheetId của tab "${tab.sheetTitle}".`);
  return googleSheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: Number(tab.sheetId),
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber
          }
        }
      }]
    }
  });
}

async function syncDeadlineWithGoogleSheet(row, { action = 'append', columns = null } = {}) {
  const settings = await getGeneralSettings();
  const sheetUrl = normalizeGoogleSheetUrl(settings.googleSheetUrl);
  if (!sheetUrl) return { skipped: true };

  const { spreadsheetId } = parseGoogleSheetReference(sheetUrl);
  const [fields, sheetReadResult] = await Promise.all([
    getConfiguredFields(),
    readGoogleSheetTabs({ ...settings, googleSheetUrl: sheetUrl })
  ]);
  const missingFields = new Set((sheetReadResult.missingTabs || []).map(({ field }) => String(field ?? '').trim().toLowerCase()).filter(Boolean));
  if (missingFields.has(String(row.type ?? '').trim().toLowerCase())) {
    throw new Error(`Không thể đồng bộ hai chiều vì thiếu tab Google Sheet: ${sheetReadResult.missingTabs.map(({ field, missingTab }) => `${field} → "${missingTab}"`).join(', ')}.`);
  }
  const tabs = sheetReadResult.tabs.map((tab) => getGoogleSheetTabSnapshot(tab, fields));
  // Read the source values for dropdowns backed by another range before any
  // web-originated status write. Writing an arbitrary lowercase status into a
  // validated cell makes Sheets keep the arrow but treat the value as invalid
  // plain text instead of selecting the existing dropdown option.
  await Promise.all(tabs.map((tab) => hydrateGoogleSheetStatusOptions(spreadsheetId, tab)));
  const targetTab = getGoogleSheetTargetTab(tabs, row.type);
  // For an update, the configured tab for this row's field is authoritative.
  // Searching every tab can select a duplicate series/chapter from another
  // field and would then write the status into the wrong row.
  const existing = (targetTab ? [targetTab] : tabs)
    .map((tab) => ({ tab, match: findGoogleSheetRow(tab, row.seriesId, row.chapterNumber) }))
    .find(({ match }) => match);
  const existingAnywhere = tabs
    .map((tab) => ({ tab, match: findGoogleSheetRow(tab, row.seriesId, row.chapterNumber) }))
    .find(({ match }) => match);

  if (action === 'update') {
    // Updating an existing web row may update the matching Sheet row only.
    // Never turn an edit into a new Sheet row when the row is missing.
    if (!existing) return { skipped: true, reason: 'row-not-found' };
    const result = await writeGoogleSheetCells(
      spreadsheetId,
      existing.tab,
      existing.match.rowNumber,
      row,
      columns
    );
    return result?.skipped ? result : { updated: true };
  }

  if (action === 'delete') {
    if (existing) await deleteGoogleSheetRow(spreadsheetId, existing.tab, existing.match.rowNumber);
    return { deleted: Boolean(existing) };
  }

  if (existingAnywhere) {
    throw new Error(`Deadline ${row.seriesId}-${row.chapterNumber} đã tồn tại trên Google Sheet, không tạo thêm dòng trùng.`);
  }

  if (!targetTab) {
    throw new Error(`Không tìm thấy tab Google Sheet cho mảng "${row.type}" để đồng bộ hai chiều.`);
  }
  if (existing && existing.tab.sheetTitle === targetTab.sheetTitle) {
    const result = await writeGoogleSheetCells(spreadsheetId, existing.tab, existing.match.rowNumber, row, columns);
    return result?.skipped ? result : { updated: true };
  }
  if (existing) await deleteGoogleSheetRow(spreadsheetId, existing.tab, existing.match.rowNumber);
  await appendGoogleSheetRow(spreadsheetId, targetTab, row);
  return { inserted: true };
}

async function deleteDeadlinesFromGoogleSheet(rows) {
  if (rows.length === 0) return;
  const settings = await getGeneralSettings();
  const sheetUrl = normalizeGoogleSheetUrl(settings.googleSheetUrl);
  if (!sheetUrl) return;
  const { spreadsheetId } = parseGoogleSheetReference(sheetUrl);
  const [fields, sheetReadResult] = await Promise.all([
    getConfiguredFields(),
    readGoogleSheetTabs({ ...settings, googleSheetUrl: sheetUrl })
  ]);
  const missingFields = new Set((sheetReadResult.missingTabs || []).map(({ field }) => String(field ?? '').trim().toLowerCase()).filter(Boolean));
  if (rows.some((row) => missingFields.has(String(row.type ?? '').trim().toLowerCase()))) {
    throw new Error(`Không thể đồng bộ hai chiều vì thiếu tab Google Sheet: ${sheetReadResult.missingTabs.map(({ field, missingTab }) => `${field} → "${missingTab}"`).join(', ')}.`);
  }
  const tabs = sheetReadResult.tabs.map((tab) => getGoogleSheetTabSnapshot(tab, fields));
  const keys = new Set(rows.map((row) => `${Number(row.seriesId)}:${String(row.chapterNumber ?? '').trim()}`));
  const requests = [];
  tabs.forEach((tab) => {
    for (let index = tab.headerRowIndex + 1; index < tab.values.length; index += 1) {
      const row = tab.values[index] || [];
      if (isDecorativeGoogleSheetRow(row, tab.headerIndex, tab.fieldOverride)) continue;
      const key = `${Number(getSheetValue(row, tab.headerIndex, 'seriesId', tab.fieldOverride))}:${String(getSheetValue(row, tab.headerIndex, 'chapterNumber')).trim()}`;
      if (!keys.has(key)) continue;
      requests.push({
        deleteDimension: {
          range: {
            sheetId: Number(tab.sheetId),
            dimension: 'ROWS',
            startIndex: tab.startRow + index,
            endIndex: tab.startRow + index + 1
          }
        }
      });
    }
  });
  if (requests.length === 0) return;
  requests.sort((left, right) => {
    const leftRange = left.deleteDimension.range;
    const rightRange = right.deleteDimension.range;
    if (leftRange.sheetId !== rightRange.sheetId) return rightRange.sheetId - leftRange.sheetId;
    return rightRange.startIndex - leftRange.startIndex;
  });
  return googleSheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: { requests }
  });
}

function queueDeadlineSheetSync(row, columns) {
  const key = `${row.seriesId}:${row.chapterNumber}`;
  const previous = pendingStatusSheetSyncs.get(key) || Promise.resolve();
  let current;
  current = previous
    .catch(() => undefined)
    .then(async () => {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await syncDeadlineWithGoogleSheet(row, { action: 'update', columns });
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      throw lastError;
    })
    .catch((error) => {
      console.error(`Google Sheet Status sync failed for ${key}:`, error.message);
      return { skipped: true, error: error.message };
    })
    .finally(() => {
      if (pendingStatusSheetSyncs.get(key) === current) pendingStatusSheetSyncs.delete(key);
    });
  pendingStatusSheetSyncs.set(key, current);
  return current;
}

async function updateDeadlineAndGoogleSheet(keys, updates, allowedColumns) {
  const currentRows = await selectRows('deadlines');
  const current = currentRows.find((item) => Object.entries(keys).every(([key, value]) => String(item[key]) === String(value)));
  if (!current) throw new Error('Không tìm thấy deadline cần cập nhật.');
  const data = await updateRow('deadlines', keys, updates, allowedColumns);
  // Keep the Sheet in sync for values edited from the web. File is a
  // checkbox column, so it must be written before the request completes;
  // otherwise the next full sync can read the old checkbox and overwrite the
  // value that was just saved in the database.
  const sheetColumns = ['status', 'statusRaw'].filter((column) => (
    Object.prototype.hasOwnProperty.call(updates, column)
  ));
  if (sheetColumns.length > 0) {
    await queueDeadlineSheetSync(data, sheetColumns);
  }
  return data;
}

async function insertDeadlineAndGoogleSheet(payload, allowedColumns) {
  const settings = await getGeneralSettings();
  if (normalizeGoogleSheetUrl(settings.googleSheetUrl)) await syncGoogleSheet();
  const data = await insertRow('deadlines', payload, allowedColumns);
  try {
    await syncDeadlineWithGoogleSheet(data);
    return data;
  } catch (error) {
    try {
      await deleteRowsByKeys('deadlines', { seriesId: data.seriesId, chapterNumber: data.chapterNumber });
    } catch (rollbackError) {
      throw new Error(`${error.message} Không thể khôi phục dòng web sau lỗi đồng bộ: ${rollbackError.message}`);
    }
    throw new Error(`${error.message} Dòng web đã được khôi phục để giữ hai bên nhất quán.`);
  }
}

async function syncGoogleSheet() {
  if (googleSheetSyncPromise) return googleSheetSyncPromise;
  googleSheetSyncPromise = (async () => {
    const settings = await getGeneralSettings();
    const sheetUrl = normalizeGoogleSheetUrl(settings.googleSheetUrl);
    if (!sheetUrl) throw validationError('Chưa cấu hình link Google Sheet trong Cấu hình chung.');
    const { spreadsheetId } = parseGoogleSheetReference(sheetUrl);
    const sheetReadResult = await readGoogleSheetTabs({ ...settings, googleSheetUrl: sheetUrl });
    const rawTabs = sheetReadResult.tabs;
    const missingTabs = sheetReadResult.missingTabs || [];
    const [fields, prices, freelancers, qcs, currentRows] = await Promise.all([
      getConfiguredFields(),
      getCollection('difficultyPricing'),
      getCollection('freelancers'),
      getMergedQCs(),
      getCollection('deadlines')
    ]);
    const missingConfiguredFields = new Set(missingTabs.map(({ field }) => String(field ?? '').trim().toLowerCase()).filter(Boolean));
    const missingRows = currentRows.filter((row) => missingConfiguredFields.has(String(row.type ?? '').trim().toLowerCase()));
    if (missingRows.length) {
      throw new Error(`Không thể đồng bộ hai chiều vì thiếu tab Google Sheet cho dữ liệu đang có: ${missingTabs.map(({ field, missingTab }) => `${field} → "${missingTab}"`).join(', ')}.`);
    }
    const tabs = rawTabs.map((tab) => getGoogleSheetTabSnapshot(tab, fields));
    await Promise.all(tabs.map((tab) => hydrateGoogleSheetStatusOptions(spreadsheetId, tab)));
    const mappedRows = [];
    const skippedRows = [];
    const invalidRows = [];
    const invalidSheetKeys = new Set();
    let hiddenRows = 0;
    for (const tab of tabs) {
      const headerRowIndex = findGoogleSheetHeaderRow(tab.values);
      const headers = tab.values[headerRowIndex].map(normalizeSheetHeader);
      const headerIndex = new Map(headers.map((header, index) => [header, index]));
      const fieldOverride = tab.field ? normalizeImportedField(tab.field, fields, 1) : null;
      hiddenRows += [...(tab.hiddenRows || [])].filter((index) => index > headerRowIndex).length;
      tab.values
        .map((row, index) => ({ row, index }))
        .filter(({ index }) => index > headerRowIndex && !tab.hiddenRows?.has(index))
          .map(({ row, index }) => ({ row, rowNumber: tab.startRow + index + 1 }))
        .filter(({ row }) => !isDecorativeGoogleSheetRow(row, headerIndex, fieldOverride))
        .forEach(({ row, rowNumber }) => {
          if (isIncompleteGoogleSheetRow(row, headerIndex, fieldOverride)) {
            skippedRows.push({ tab: tab.range, rowNumber });
            return;
          }
          try {
            mappedRows.push({
              tab,
              sheetRowNumber: rowNumber,
              headerIndex,
              fieldOverride,
              sourceRow: row,
              data: buildImportedDeadline(row, headerIndex, fields, prices, freelancers, qcs, rowNumber, fieldOverride)
            });
          } catch (error) {
            invalidRows.push({ tab: tab.range, rowNumber, message: error.message });
            const invalidKey = getSheetDeadlineKey(row, headerIndex, fieldOverride);
            if (invalidKey) invalidSheetKeys.add(invalidKey);
          }
        });
    }
    const uniqueRowsByKey = new Map();
    let duplicateRows = 0;
    for (const entry of mappedRows) {
      const row = entry.data;
      const key = `${row.seriesId}:${row.chapterNumber}`;
      if (uniqueRowsByKey.has(key)) duplicateRows += 1;
      const currentEntry = uniqueRowsByKey.get(key);
      if (!currentEntry || getImportedDeadlineCompleteness(entry) >= getImportedDeadlineCompleteness(currentEntry)) {
        uniqueRowsByKey.set(key, entry);
      }
    }
    let uniqueRows = [...uniqueRowsByKey.values()];

    const allowedColumns = ['endTask', 'receivedAt', 'submittedAt', 'seriesName', 'type', 'statusRaw', 'status', 'doingStartedAt', 'workDurationSeconds', 'urlSeries', 'fIld', 'assignedAt', 'assignedAdminId', 'qcId', 'difficulty', 'price', 'receivePrice', 'feedback', 'late', 'completionPercent', 'paymentApproved'];
    const currentRowsByKey = new Map(currentRows.map((item) => [
      `${Number(item.seriesId)}:${String(item.chapterNumber ?? '').trim()}`,
      item
    ]));
    // Preserve a URL that was previously filled automatically when the Sheet
    // still has an empty URL column. New rows without a URL are enriched from
    // a matching Google Drive folder named after their series ID.
    const rowsWithPreservedUrls = uniqueRows.map((entry) => {
      if (isHttpUrl(entry.data.urlSeries)) return entry;
      const key = `${Number(entry.data.seriesId)}:${String(entry.data.chapterNumber ?? '').trim()}`;
      const currentUrl = currentRowsByKey.get(key)?.urlSeries;
      return isHttpUrl(currentUrl)
        ? { ...entry, data: { ...entry.data, urlSeries: currentUrl } }
        : entry;
    });
    const rowsToLookup = rowsWithPreservedUrls.filter((entry) => (
      !isHttpUrl(entry.data.urlSeries)
      || Boolean(getConfiguredDriveRootFolder(entry.data.type, settings.googleDriveFolders))
    ));
    const driveLinkResult = await enrichRowsWithGoogleDriveLinks(rowsWithPreservedUrls, rowsToLookup, settings.googleDriveFolders);
    uniqueRows = driveLinkResult.rows;
    const writeResults = await runWithConcurrency(uniqueRows, async ({ data: row, headerIndex, fieldOverride, tab, sheetRowNumber, sourceRow }) => {
      const key = `${row.seriesId}:${row.chapterNumber}`;
      const current = currentRowsByKey.get(key);
      const importedTiming = current && row.status
        ? buildImportedTimingTransition(current, row.status)
        : {};
      const hasFreelancerColumn = getGoogleSheetHeaderIndex(headerIndex, 'fIld', fieldOverride) !== undefined;
      const assignmentChanged = Boolean(current) && hasFreelancerColumn
        && String(current.fIld ?? '') !== String(row.fIld ?? '');
      const synchronizedRow = {
        ...row,
        ...importedTiming,
        ...(assignmentChanged
          ? { assignedAt: hasFreelancerAssignment(row) ? new Date().toISOString() : null }
          : {})
      };
      const rowAllowedColumns = allowedColumns.filter((column) => {
        // A missing Sheet column is not permission to overwrite the web value
        // with a default/null value. The configured tab itself represents the
        // field for a tab-scoped type column such as a configured field.
        const hasColumn = column === 'type' && fieldOverride
          ? true
          : getGoogleSheetHeaderIndex(headerIndex, column, fieldOverride) !== undefined;
        return hasColumn && Object.prototype.hasOwnProperty.call(synchronizedRow, column);
      });
      const writeColumns = [...new Set([
        ...rowAllowedColumns,
        'doingStartedAt',
        'workDurationSeconds',
        'submittedAt'
      ])].filter((column) => Object.prototype.hasOwnProperty.call(synchronizedRow, column));
      if (Object.prototype.hasOwnProperty.call(synchronizedRow, 'assignedAt')) writeColumns.push('assignedAt');
      const repairStatus = async () => {
        try {
          return { statusRepaired: await repairGoogleSheetStatusCell(spreadsheetId, tab, sheetRowNumber, synchronizedRow, sourceRow) };
        } catch (error) {
          return { statusRepairError: error.message };
        }
      };
      if (current) {
        if (!hasDeadlineSheetChanges(current, synchronizedRow, writeColumns)) {
          return { result: 'unchanged', ...(await repairStatus()) };
        }
        await updateRow('deadlines', { seriesId: row.seriesId, chapterNumber: row.chapterNumber }, synchronizedRow, writeColumns);
        return { result: 'updated', ...(await repairStatus()) };
      }
      const initialTiming = {
        doingStartedAt: synchronizedRow.doingStartedAt ?? (synchronizedRow.status === 'doing' ? new Date().toISOString() : null),
        workDurationSeconds: synchronizedRow.workDurationSeconds ?? 0,
        submittedAt: synchronizedRow.submittedAt ?? (synchronizedRow.status === 'submitted' ? new Date().toISOString() : null)
      };
      const insertRowData = {
        ...synchronizedRow,
        ...initialTiming,
        assignedAt: synchronizedRow.assignedAt ?? (hasFreelancerAssignment(synchronizedRow) ? new Date().toISOString() : null),
        receivedAt: synchronizedRow.receivedAt ?? new Date().toISOString()
      };
      await insertRow('deadlines', {
        ...insertRowData
      }, ['seriesId', 'chapterNumber', ...writeColumns, 'assignedAt', 'receivedAt', 'doingStartedAt', 'workDurationSeconds', 'submittedAt']);
      return { result: 'inserted', ...(await repairStatus()) };
    });
    const inserted = writeResults.filter(({ result }) => result === 'inserted').length;
    const updated = writeResults.filter(({ result }) => result === 'updated').length;
    const repairedStatuses = writeResults.filter(({ statusRepaired }) => statusRepaired).length;
    const statusRepairErrors = writeResults
      .map(({ statusRepairError }) => statusRepairError)
      .filter(Boolean);

    // Reconcile deletions against valid imported ID + Chapter keys, even when
    // other rows were skipped because their identifiers are incomplete.
    let deleted = 0;
    const sheetKeys = new Set([
      ...uniqueRows.map(({ data }) => `${data.seriesId}:${data.chapterNumber}`),
      ...invalidSheetKeys
    ]);
    const missingFields = new Set(missingTabs.map(({ field }) => String(field ?? '').trim().toLowerCase()).filter(Boolean));
    const rowsToDelete = currentRows.filter((current) => {
      // A missing configured tab is not evidence that its existing rows were
      // deleted from the Sheet. Preserve them until that tab is restored or
      // its mapping is removed from settings.
      if (missingFields.has(String(current.type ?? '').trim().toLowerCase())) return false;
      const key = `${Number(current.seriesId)}:${String(current.chapterNumber ?? '').trim()}`;
      return !sheetKeys.has(key);
    });
    const deletedCounts = await runWithConcurrency(rowsToDelete, async (current) => {
      const removedRows = await deleteRowsByKeys('deadlines', {
        seriesId: current.seriesId,
        chapterNumber: current.chapterNumber
      });
      return removedRows.length;
    });
    deleted = deletedCounts.reduce((total, count) => total + count, 0);

    const syncedAt = new Date().toISOString();
    const syncWarnings = [];
    if (deleted) {
      syncWarnings.push(`Đã xóa ${deleted} dòng không còn trên Google Sheet.`);
    }
    if (repairedStatuses) {
      syncWarnings.push(`Đã tự sửa ${repairedStatuses} ô Status về đúng option dropdown trên Google Sheet.`);
    }
    if (statusRepairErrors.length) {
      syncWarnings.push(`Chưa tự sửa được ${statusRepairErrors.length} ô Status: ${statusRepairErrors.slice(0, 3).join('; ')}.`);
    }
    // Rows without a complete synchronization key are treated as acceptable
    // Sheet rows and are simply ignored for deadline reconciliation. Duplicate
    // keys are resolved by the Map above, so the last row remains authoritative.
    // Neither case is an error or a user-facing warning.
    if (invalidRows.length) {
      const invalidSummary = invalidRows.slice(0, 5)
        .map(({ rowNumber, message }) => `Dòng ${rowNumber}: ${String(message).replace(/^Dòng \d+:\s*/i, '')}`)
        .join('; ');
      syncWarnings.push(`Bỏ qua ${invalidRows.length} dòng lỗi dữ liệu nhưng vẫn giữ khóa dòng trên Sheet để không xóa nhầm: ${invalidSummary}.`);
    }
    if (driveLinkResult.missing) {
      syncWarnings.push(`Không tìm thấy folder Google Drive cho ${driveLinkResult.missing} ID bộ truyện.`);
    }
    if (driveLinkResult.error) {
      syncWarnings.push(`Không thể tự gắn link Google Drive: ${getSafeErrorMessage(driveLinkResult.error, 'Không thể tự gắn link Google Drive.')}`);
    }
    if (missingTabs.length) {
      syncWarnings.push(`Bỏ qua ${missingTabs.length} tab chưa tồn tại: ${missingTabs.map(({ field, missingTab }) => `${field} → "${missingTab}"`).join(', ')}.`);
    }
    const rowsWithoutPricing = uniqueRows.filter(({ data }) => !data.difficulty || data.price === null || data.price === undefined).length;
    if (rowsWithoutPricing) {
      syncWarnings.push(`Đã đồng bộ ${rowsWithoutPricing} dòng chưa có Difficulty/Price; có thể bổ sung sau trên web hoặc trong Sheet.`);
    }
    const currentSettings = (await getCollection('generalSettings'))[0];
    if (currentSettings) {
      await updateRow('generalSettings', { id: currentSettings.id }, {
        googleSheetLastSyncedAt: syncedAt,
        googleSheetLastSyncCount: uniqueRows.length,
        googleSheetLastSyncError: syncWarnings.join(' ')
      }, ['googleSheetLastSyncedAt', 'googleSheetLastSyncCount', 'googleSheetLastSyncError']);
    }
    return { inserted, updated, deleted, repairedStatuses, statusRepairErrors, total: uniqueRows.length, sheetRows: uniqueRows.length, skipped: skippedRows.length + invalidRows.length, invalid: invalidRows.length, duplicates: duplicateRows, hidden: hiddenRows, driveLinked: driveLinkResult.linked, driveMissing: driveLinkResult.missing, driveError: driveLinkResult.error ? getSafeErrorMessage(driveLinkResult.error, 'Không thể tự gắn link Google Drive.') : '', skippedRows: [...skippedRows, ...invalidRows].slice(0, 20), syncedAt };
  })().catch(async (error) => {
    try {
      const currentSettings = (await getCollection('generalSettings'))[0];
      if (currentSettings) {
        await updateRow('generalSettings', { id: currentSettings.id }, { googleSheetLastSyncError: getSafeErrorMessage(error, 'Google Sheet chưa đồng bộ thành công.') }, ['googleSheetLastSyncError']);
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

async function syncGoogleSheetIfDue({ waitForCompletion = false } = {}) {
  const settings = await getGeneralSettings();
  if (settings.googleSheetAutoSync !== true || !settings.googleSheetUrl) return;
  const lastSyncedAt = settings.googleSheetLastSyncedAt ? new Date(settings.googleSheetLastSyncedAt).getTime() : 0;
  if (Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < 5 * 60 * 1000) return;

  const syncPromise = syncGoogleSheet();
  if (waitForCompletion) {
    await syncPromise;
    return;
  }

  // Keep background auto-sync non-blocking for other read endpoints.
  syncPromise.catch((error) => {
    console.error('Google Sheet auto sync failed:', error.message);
  });
}

const ERROR_TYPE_OPTIONS = ['TR', 'File', 'Censor', 'Exposure', 'Logo/Credit', 'Text', 'SFX', 'Image', 'Bubble', 'Aesthetics', 'RD'];
const ERROR_SHEET_COLUMNS = ['title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editor', 'fixCheck'];
const errorSheetHeaderAliases = {
  title: ['title', 'series', 'seriesname', 'tensries', 'tentruyen', 'name'],
  chapter: ['chapter', 'chap', 'chapternumber', 'chapterno', 'sochapter', 'chuong'],
  errorType: ['errortype', 'errorkind', 'category', 'loailoi', 'loailo'],
  screenshot: ['screenshot', 'screenshots', 'sreenshot', 'image', 'img', 'anh', 'hinhanh', 'anhchup', 'hinhanhloi'],
  error: ['error', 'issue', 'bug', 'description', 'loi', 'noidungloi'],
  note: ['note', 'feedback', 'comment', 'comments', 'ghichu', 'noteofflorqc', 'notecuaflorqc', 'notecuaflhoacqc'],
  editor: ['editor', 'freelancer', 'freelancername', 'fl', 'nguoiduocgiao', 'nguoi sua'],
  fixCheck: ['fixcheck', 'fix', 'check', 'fixed', 'checked', 'done', 'da xem']
};

// Serialize imports, checkbox reads and edits so an older import cannot
// overwrite a checkbox after a successful web edit in this server process.
let errorSheetOperation = Promise.resolve();
function withErrorSheetLock(operation) {
  const result = errorSheetOperation.then(operation);
  errorSheetOperation = result.catch(() => undefined);
  return result;
}

function readErrorCheckbox(cell, fallback = '') {
  const condition = cell?.dataValidation?.condition;
  const value = cell?.effectiveValue ?? cell?.userEnteredValue ?? {};
  const actual = value.boolValue ?? value.stringValue ?? value.numberValue ?? fallback;
  if (condition?.type === 'BOOLEAN' && condition.values?.length) {
    return String(actual) === String(condition.values[0].userEnteredValue);
  }
  return parseImportedBoolean(actual);
}

function getErrorCheckboxValue(cell, checked) {
  const condition = cell?.dataValidation?.condition;
  if (condition?.type !== 'BOOLEAN' || cell?.userEnteredValue?.formulaValue) {
    throw validationError('Ô Fix/Check trên Sheet phải là checkbox có sẵn và không chứa công thức. Chưa ghi thay đổi.');
  }
  const values = condition.values || [];
  if (values.length > 2) throw validationError('Cấu hình checkbox Fix/Check không hợp lệ.');
  if (values.length === 0) return { boolValue: checked };
  // Respect custom checked/unchecked values without parsing them as formulas.
  return { stringValue: String(values[checked ? 0 : 1]?.userEnteredValue ?? '') };
}

function requireErrorSheetColumn(sheet, key) {
  const aliases = new Set(errorSheetHeaderAliases[key].map(normalizeSheetHeader));
  const matches = (sheet.values[sheet.headerRowIndex] || [])
    .map((header, index) => aliases.has(normalizeSheetHeader(header)) ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length !== 1) throw validationError(`Cột ${key === 'fixCheck' ? 'Fix/Check' : key} bị thiếu hoặc trùng trên Sheet. Chưa ghi thay đổi.`);
  return matches[0];
}

function findErrorCheckboxTarget(sheet, current, freelancers) {
  const source = current.sourceUrl ? parseGoogleSheetReference(current.sourceUrl) : null;
  if (!source || source.spreadsheetId !== sheet.spreadsheetId || source.gid === null || String(source.gid) !== String(sheet.sheetId)) {
    throw validationError('Liên kết hàng lỗi không khớp tab Sheet đã cấu hình. Hãy đồng bộ từ Sheet trước khi tick.');
  }
  const columns = Object.fromEntries(['title', 'chapter', 'error', 'editor', 'fixCheck']
    .map((key) => [key, requireErrorSheetColumn(sheet, key)]));
  const matches = [];
  for (let index = sheet.headerRowIndex + 1; index < sheet.values.length; index += 1) {
    const row = sheet.values[index] || [];
    if (!['title', 'chapter', 'error'].every((key) => String(row[columns[key]] ?? '').trim() === String(current[key] ?? '').trim())) continue;
    const editor = resolveErrorEditor(row[columns.editor], freelancers);
    const sameEditor = current.editorFreelancerId != null
      ? String(editor.id) === String(current.editorFreelancerId)
      : editor.name === String(current.editor ?? '').trim();
    if (sameEditor) matches.push(index);
  }
  const index = matches[0];
  const rowIndex = sheet.rangeMeta.startRow + index;
  if (matches.length !== 1 || rowIndex + 1 !== Number(current.sourceRow) || sheet.hiddenRows?.has(index)) {
    throw validationError('Hàng lỗi đã thay đổi, bị ẩn hoặc bị trùng trên Sheet. Hãy đồng bộ từ Sheet trước khi tick.');
  }
  const columnIndex = sheet.rangeMeta.startColumn + columns.fixCheck;
  if (sheet.merges?.some((range) => rowIndex >= (range.startRowIndex ?? 0) && rowIndex < (range.endRowIndex ?? Infinity)
    && columnIndex >= (range.startColumnIndex ?? 0) && columnIndex < (range.endColumnIndex ?? Infinity))) {
    throw validationError('Ô Fix/Check đang được gộp trên Sheet. Chưa ghi thay đổi.');
  }
  const cell = sheet.cellData[index]?.[columns.fixCheck];
  getErrorCheckboxValue(cell, false); // Validate existing checkbox before either direction of sync.
  return { rowIndex, columnIndex, cell };
}

async function writeErrorFixCheck(current, checked) {
  // App-only errors have no destination. Never append or manufacture a row.
  if (!current.sourceRow) return {};
  const settings = await getGeneralSettings();
  const sheetUrl = getConfiguredErrorSheetUrl(settings.errorSheetUrls, current.field);
  if (!sheetUrl) throw validationError('Chưa cấu hình Sheet cho hàng lỗi này. Chưa ghi thay đổi.');
  const [sheet, freelancers] = await Promise.all([
    readErrorGoogleSheet(current.field, sheetUrl, { includeImages: false }),
    getCollection('freelancers')
  ]);
  const { rowIndex, columnIndex, cell } = findErrorCheckboxTarget(sheet, current, freelancers);
  await googleSheetsRequest(`spreadsheets/${encodeURIComponent(sheet.spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: {
      requests: [{ updateCells: {
        range: { sheetId: sheet.sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 },
        rows: [{ values: [{ userEnteredValue: getErrorCheckboxValue(cell, checked) }] }],
        fields: 'userEnteredValue'
      } }]
    }
  });
  return {};
}

async function refreshErrorFixChecks(user) {
  const [settings, allRows, freelancers] = await Promise.all([
    getGeneralSettings(), getCollection('errors'), getCollection('freelancers')
  ]);
  const rows = filterErrorRowsForUser(allRows, user);
  const fields = [...new Set(rows.filter((row) => row.sourceRow).map((row) => row.field))];
  const warnings = [];
  const sheets = new Map();
  await Promise.all(fields.map(async (field) => {
    const url = getConfiguredErrorSheetUrl(settings.errorSheetUrls, field);
    if (!url) return;
    try {
      sheets.set(field, await readErrorGoogleSheet(field, url, { includeImages: false }));
    } catch (error) {
      warnings.push(getSafeErrorMessage(error, 'Không thể đọc Fix/Check từ Sheet.'));
    }
  }));
  await runWithConcurrency(rows, async (row) => {
    const sheet = sheets.get(row.field);
    if (!row.sourceRow || !sheet) return;
    try {
      const { cell } = findErrorCheckboxTarget(sheet, row, freelancers);
      const fixCheck = readErrorCheckbox(cell);
      if (fixCheck !== row.fixCheck) {
        await updateRowById('errors', row.id, { fixCheck, updatedAt: new Date().toISOString() }, ['fixCheck', 'updatedAt']);
        row.fixCheck = fixCheck;
      }
    } catch (error) {
      warnings.push(getSafeErrorMessage(error, 'Không thể đồng bộ Fix/Check.'));
    }
  });
  return { rows: rows.map(({ id, fixCheck }) => ({ id, fixCheck })), warnings: [...new Set(warnings)].slice(0, 3) };
}

function getErrorSheetHeaderIndex(headerIndex, key) {
  return (errorSheetHeaderAliases[key] || [])
    .map((alias) => headerIndex.get(normalizeSheetHeader(alias)))
    .find((index) => index !== undefined);
}

function findErrorSheetHeaderRow(values) {
  let bestIndex = -1;
  let bestScore = 0;
  values.forEach((row, index) => {
    const normalizedHeaders = new Set(row.map(normalizeSheetHeader));
    const score = ['title', 'chapter', 'error', 'editor'].reduce((total, key) => (
      (errorSheetHeaderAliases[key] || []).some((alias) => normalizedHeaders.has(normalizeSheetHeader(alias)))
        ? total + 1
        : total
    ), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  if (bestIndex === -1 || bestScore < 3) {
    throw validationError('Không tìm thấy dòng tiêu đề hợp lệ. Cần có các cột Title, Chapter, Error và Editor trong sheet lỗi.');
  }
  return bestIndex;
}

function getErrorSheetValue(row, headerIndex, key, cellDataRow = []) {
  const index = getErrorSheetHeaderIndex(headerIndex, key);
  if (index === undefined) return '';
  const cell = cellDataRow?.[index];
  const formulaValue = cell?.userEnteredValue?.formulaValue;
  if ((key === 'screenshot' || key === 'note') && formulaValue) return String(formulaValue).trim();
  const stringValue = cell?.userEnteredValue?.stringValue;
  if ((key === 'screenshot' || key === 'note') && stringValue) return String(stringValue).trim();
  const effectiveStringValue = cell?.effectiveValue?.stringValue;
  if ((key === 'screenshot' || key === 'note') && effectiveStringValue) return String(effectiveStringValue).trim();
  return String(row[index] ?? '').trim();
}

function isDecorativeErrorSheetRow(row, headerIndex, cellDataRow = [], directImages = []) {
  if (directImages.some(Boolean)) return false;
  return ERROR_SHEET_COLUMNS.every((key) => {
    const value = getErrorSheetValue(row, headerIndex, key, cellDataRow);
    if (key !== 'fixCheck') return !value;
    // Unchecked checkboxes are often prefilled through otherwise empty rows.
    return !readErrorCheckbox(cellDataRow[getErrorSheetHeaderIndex(headerIndex, key)], value);
  });
}

function normalizeZipPath(value) {
  const parts = String(value ?? '').replace(/^\/+/, '').split('/');
  const normalized = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

function resolveZipPath(basePath, target) {
  const rawTarget = String(target ?? '').trim();
  if (rawTarget.startsWith('/')) return normalizeZipPath(rawTarget);
  const baseDirectory = String(basePath ?? '').slice(0, String(basePath ?? '').lastIndexOf('/'));
  return normalizeZipPath(`${baseDirectory}/${rawTarget}`);
}

function parseZipEntries(buffer) {
  const endOfCentralDirectorySignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const centralDirectorySignature = 0x02014b50;
  const localFileSignature = 0x04034b50;
  const endOfCentralDirectoryOffset = buffer.lastIndexOf(endOfCentralDirectorySignature);
  if (endOfCentralDirectoryOffset < 0) throw new Error('File xuất Google Sheet không phải ZIP/XLSX hợp lệ.');

  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectoryOffset + 16);
  const centralDirectorySize = buffer.readUInt32LE(endOfCentralDirectoryOffset + 12);
  const entries = new Map();
  let cursor = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (cursor < end) {
    if (buffer.readUInt32LE(cursor) !== centralDirectorySignature) break;
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localFileOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.toString('utf8', cursor + 46, cursor + 46 + fileNameLength);
    const localHeaderNameLength = buffer.readUInt16LE(localFileOffset + 26);
    const localHeaderExtraLength = buffer.readUInt16LE(localFileOffset + 28);
    const dataStart = localFileOffset + 30 + localHeaderNameLength + localHeaderExtraLength;
    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (compressionMethod === 0) data = compressedData;
    else if (compressionMethod === 8) data = inflateRawSync(compressedData);
    else {
      cursor += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }
    entries.set(normalizeZipPath(fileName), data);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function getZipText(entries, filePath) {
  const data = entries.get(normalizeZipPath(filePath));
  return data ? data.toString('utf8') : '';
}

function parseXmlAttributes(tag) {
  return Object.fromEntries([...String(tag ?? '').matchAll(/([A-Za-z_][\w:.-]*)="([^"]*)"/g)]
    .map((match) => [match[1], match[2] ?? '']));
}

function parseZipRelationships(xml) {
  const relationships = {};
  for (const match of String(xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const attributes = parseXmlAttributes(match[0]);
    if (attributes.Id && attributes.Target) relationships[attributes.Id] = attributes.Target;
  }
  return relationships;
}

function xmlDecode(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getSheetRelationshipPath(sheetPath) {
  const slashIndex = sheetPath.lastIndexOf('/');
  const directory = slashIndex >= 0 ? sheetPath.slice(0, slashIndex) : '';
  const fileName = slashIndex >= 0 ? sheetPath.slice(slashIndex + 1) : sheetPath;
  return normalizeZipPath(`${directory}/_rels/${fileName}.rels`);
}

function getDrawingAnchors(xml) {
  const anchors = [];
  for (const match of String(xml ?? '').matchAll(/<xdr:(?:oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:oneCellAnchor|twoCellAnchor)>/g)) {
    const content = match[1];
    const from = content.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/);
    const embed = content.match(/<a:blip\b[^>]*r:embed="([^"]+)"/);
    if (from && embed) anchors.push({ row: Number(from[2]), column: Number(from[1]), relationshipId: embed[1] });
  }
  return anchors;
}

function imageMimeType(filePath) {
  const extension = String(filePath ?? '').split('.').pop()?.toLowerCase();
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  }[extension] || '';
}

function imageBufferToDataUrl(filePath, data) {
  const mimeType = imageMimeType(filePath);
  if (!mimeType || !data || data.length > 3 * 1024 * 1024) return '';
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

function parseGoogleSheetImageCells(workbookBuffer, sheetTitle) {
  const entries = parseZipEntries(workbookBuffer);
  const workbookXml = getZipText(entries, 'xl/workbook.xml');
  const workbookRelationships = parseZipRelationships(getZipText(entries, 'xl/_rels/workbook.xml.rels'));
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)]
    .map((match) => ({ tag: match[0], attributes: parseXmlAttributes(match[0]) }))
    .find(({ attributes }) => xmlDecode(attributes.name) === String(sheetTitle));
  if (!sheetTag?.attributes?.['r:id']) return new Map();

  const worksheetPath = resolveZipPath('xl/workbook.xml', workbookRelationships[sheetTag.attributes['r:id']]);
  const worksheetXml = getZipText(entries, worksheetPath);
  const worksheetDrawingTag = [...worksheetXml.matchAll(/<drawing\b[^>]*>/g)][0]?.[0];
  const drawingRelationshipId = parseXmlAttributes(worksheetDrawingTag)?.['r:id'];
  if (!drawingRelationshipId) return new Map();

  const worksheetRelationships = parseZipRelationships(getZipText(entries, getSheetRelationshipPath(worksheetPath)));
  const drawingPath = resolveZipPath(worksheetPath, worksheetRelationships[drawingRelationshipId]);
  const drawingXml = getZipText(entries, drawingPath);
  const drawingRelationships = parseZipRelationships(getZipText(entries, getSheetRelationshipPath(drawingPath)));
  const imageCells = new Map();
  getDrawingAnchors(drawingXml).forEach(({ row, column, relationshipId }) => {
    const imagePath = resolveZipPath(drawingPath, drawingRelationships[relationshipId]);
    const dataUrl = imageBufferToDataUrl(imagePath, entries.get(imagePath));
    if (dataUrl) {
      const cellKey = `${row}:${column}`;
      imageCells.set(cellKey, [...(imageCells.get(cellKey) || []), dataUrl]);
    }
  });
  return imageCells;
}

async function readGoogleSheetImageCells(spreadsheetId, sheetId, sheetTitle) {
  try {
    const workbookBuffer = await googleSheetTabExportRequest(spreadsheetId, sheetId);
    return parseGoogleSheetImageCells(workbookBuffer, sheetTitle);
  } catch {
    // Some Google accounts do not allow the direct export endpoint for a
    // service account. Fall back to copying only the target tab so the full
    // workbook size does not affect image extraction.
  }

  let temporarySpreadsheetId = '';
  try {
    const temporarySpreadsheet = await googleSheetsRequest('spreadsheets', {
      method: 'POST',
      body: { properties: { title: `QC image sync ${Date.now()}` } }
    });
    temporarySpreadsheetId = temporarySpreadsheet.spreadsheetId || '';
    if (!temporarySpreadsheetId) throw new Error('Không tạo được file tạm để đọc ảnh trực tiếp từ Google Sheet.');

    const copiedSheet = await googleSheetsRequest(
      `spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets/${encodeURIComponent(sheetId)}:copyTo`,
      { method: 'POST', body: { destinationSpreadsheetId: temporarySpreadsheetId } }
    );
    const exportPath = `files/${encodeURIComponent(temporarySpreadsheetId)}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`;
    const workbookBuffer = await googleDriveBinaryRequest(exportPath);
    return parseGoogleSheetImageCells(workbookBuffer, copiedSheet.title || `Copy of ${sheetTitle}`);
  } catch (error) {
    if (/Service Account chưa được cấp quyền truy cập Google Sheets API/i.test(error?.message || '')) {
      throw new Error('Service Account cần quyền Editor trên Google Sheet để đọc ảnh trực tiếp.');
    }
    throw error;
  } finally {
    if (temporarySpreadsheetId) {
      try {
        await deleteGoogleDriveFile(temporarySpreadsheetId);
      } catch (error) {
        console.warn('Không thể dọn file tạm đọc ảnh Google Sheet:', error.message);
      }
    }
  }
}

async function readErrorGoogleSheet(field, sheetUrl, { includeImages = true } = {}) {
  const { spreadsheetId, gid } = parseGoogleSheetReference(sheetUrl);
  const metadata = await getGoogleSheetMetadata(spreadsheetId);
  const sheets = metadata.sheets || [];
  const selectedSheet = gid
    ? sheets.find((sheet) => String(sheet.properties?.sheetId) === String(gid))
    : sheets[0];
  if (!selectedSheet?.properties?.title) {
    throw new Error(`Không tìm thấy tab của sheet lỗi cho mảng "${field}".`);
  }
  const range = `${quoteGoogleSheetTitle(selectedSheet.properties.title)}!A:ZZ`;
  const rangeMeta = parseGoogleSheetA1Range(range);
  const valuesResult = await readGoogleSheetValues(spreadsheetId, range);
  const headerRowIndex = findErrorSheetHeaderRow(valuesResult.values);
  const headers = valuesResult.values[headerRowIndex].map(normalizeSheetHeader);
  let imageCells = new Map();
  let imageReadError = '';
  if (includeImages && getErrorSheetHeaderIndex(new Map(headers.map((header, index) => [header, index])), 'screenshot') !== undefined) {
    try {
      imageCells = await readGoogleSheetImageCells(spreadsheetId, selectedSheet.properties.sheetId, selectedSheet.properties.title);
    } catch (error) {
      const message = getSafeErrorMessage(error, 'Không thể đọc ảnh trực tiếp từ Google Sheet.');
      imageReadError = /cần quyền Editor trên Google Sheet để đọc ảnh trực tiếp/i.test(message)
        ? `Service Account cần quyền Editor trên Google Sheet lỗi của mảng "${field}" để đọc ảnh trực tiếp.`
        : message;
    }
  }
  return {
    field,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit?gid=${selectedSheet.properties.sheetId}`,
    spreadsheetId,
    sheetId: selectedSheet.properties.sheetId,
    sheetTitle: selectedSheet.properties.title,
    range,
    rangeMeta,
    ...valuesResult,
    imageCells,
    imageReadError,
    headerRowIndex,
    headerIndex: new Map(headers.map((header, index) => [header, index]))
  };
}

function getFreelancerId(row) {
  return row?.fIld ?? row?.fId ?? row?.id ?? null;
}

function resolveErrorEditor(value, freelancers) {
  const text = String(value ?? '').trim();
  if (!text) return { id: null, name: '' };
  const normalized = text.toLowerCase();
  const numeric = Number(text);
  const match = freelancers.find((freelancer) => (
    (Number.isInteger(numeric) && String(getFreelancerId(freelancer)) === String(numeric))
      || String(freelancer.name || '').trim().toLowerCase() === normalized
      || String(freelancer.email || '').trim().toLowerCase() === normalized
  ));
  return match
    ? { id: getFreelancerId(match), name: match.name || match.email || text }
    : { id: null, name: text };
}

function buildImportedError(row, headerIndex, freelancers, sourceRow, field, sourceUrl, cellDataRow = []) {
  const editor = resolveErrorEditor(getErrorSheetValue(row, headerIndex, 'editor', cellDataRow), freelancers);
  const noteValue = getErrorSheetValue(row, headerIndex, 'note', cellDataRow);
  return {
    field,
    title: getErrorSheetValue(row, headerIndex, 'title', cellDataRow).slice(0, 255),
    chapter: getErrorSheetValue(row, headerIndex, 'chapter', cellDataRow).slice(0, 100),
    errorType: normalizeErrorType(getErrorSheetValue(row, headerIndex, 'errorType', cellDataRow)),
    screenshot: normalizeErrorScreenshot(getErrorSheetValue(row, headerIndex, 'screenshot', cellDataRow)),
    error: getErrorSheetValue(row, headerIndex, 'error', cellDataRow),
    note: normalizeErrorScreenshot(noteValue) || nullableText(noteValue),
    editor: editor.name || null,
    editorFreelancerId: editor.id,
    fixCheck: readErrorCheckbox(cellDataRow[getErrorSheetHeaderIndex(headerIndex, 'fixCheck')], getErrorSheetValue(row, headerIndex, 'fixCheck', cellDataRow)),
    sourceRow,
    sourceUrl,
    updatedAt: new Date().toISOString()
  };
}

function normalizeErrorSyncValue(value, column) {
  if (value === null || value === undefined || value === '') return '';
  if (column === 'fixCheck') return Boolean(value) ? 'true' : 'false';
  return String(value).trim();
}

function hasErrorSheetChanges(current, imported) {
  return ['field', 'title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editor', 'editorFreelancerId', 'fixCheck', 'sourceRow', 'sourceUrl']
    .some((column) => normalizeErrorSyncValue(current[column], column) !== normalizeErrorSyncValue(imported[column], column));
}

async function syncErrorsWithGoogleSheets(user) {
  // Full sync only imports. The separate Fix/Check path is the sole writer
  // for error sheets and may update one existing checkbox value only.
  const settings = await getGeneralSettings();
  const configuredUrls = normalizeErrorSheetUrls(settings.errorSheetUrls);
  const mappings = Object.entries(configuredUrls)
    .filter(([field]) => canManagerManageField(user, field));
  if (mappings.length === 0) throw validationError('Chưa cấu hình sheet lỗi cho mảng được phép quản lý.');

  const [freelancers, currentRows] = await Promise.all([
    getCollection('freelancers'),
    getCollection('errors')
  ]);
  // Read each configured error sheet in parallel. Image extraction can take
  // several API calls, so reading tabs serially makes sync time grow linearly
  // with the number of fields.
  const sheets = await Promise.all(mappings.map(([field, url]) => readErrorGoogleSheet(field, url)));

  const sourceKeysByField = new Map();
  const warnings = [];
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  const skipped = 0;

  const currentBySourceKey = new Map();
  const currentByFallbackKey = new Map();
  currentRows.forEach((item) => {
    const fieldKey = String(item.field ?? '').trim().toLowerCase();
    if (item.sourceRow) currentBySourceKey.set(`${fieldKey}:${Number(item.sourceRow)}`, item);
    if (!item.sourceRow) {
      currentByFallbackKey.set(
        `${fieldKey}:${String(item.title ?? '').trim()}:${String(item.chapter ?? '').trim()}:${String(item.error ?? '').trim()}`,
        item
      );
    }
  });

  for (const sheet of sheets) {
    const sourceKeys = new Set();
    sourceKeysByField.set(sheet.field.toLowerCase(), sourceKeys);
    if (sheet.imageReadError) {
      warnings.push(`${sheet.field}: ${sheet.imageReadError}`);
    }
    const importedRows = [];
    const screenshotColumn = getErrorSheetHeaderIndex(sheet.headerIndex, 'screenshot');
    const noteColumn = getErrorSheetHeaderIndex(sheet.headerIndex, 'note');
    const imageRowCount = Array.from(sheet.imageCells?.keys() || [])
      .reduce((count, key) => Math.max(count, Number(String(key).split(':')[0]) + 1), 0);
    const rowCount = Math.max(sheet.values.length, sheet.cellData.length, imageRowCount);
    for (let index = sheet.headerRowIndex + 1; index < rowCount; index += 1) {
      if (sheet.hiddenRows?.has(index)) continue;
      const row = sheet.values[index] || [];
      const cellDataRow = sheet.cellData[index] || [];
      const directScreenshot = screenshotColumn === undefined ? '' : sheet.imageCells?.get(`${index}:${screenshotColumn}`) || '';
      const directNote = noteColumn === undefined ? '' : sheet.imageCells?.get(`${index}:${noteColumn}`) || '';
      if (isDecorativeErrorSheetRow(row, sheet.headerIndex, cellDataRow, [directScreenshot, directNote])) continue;
      const sourceRow = sheet.rangeMeta.startRow + index + 1;
      sourceKeys.add(sourceRow);
      const imported = buildImportedError(row, sheet.headerIndex, freelancers, sourceRow, sheet.field, sheet.sourceUrl, cellDataRow);
      if (!imported.screenshot && directScreenshot) imported.screenshot = normalizeErrorScreenshot(directScreenshot);
      if (directNote && !normalizeErrorScreenshot(imported.note)) imported.note = normalizeErrorScreenshot(directNote);
      const importedErrorTypeValue = getErrorSheetValue(row, sheet.headerIndex, 'errorType');
      if (importedErrorTypeValue && !imported.errorType) {
        warnings.push(`${sheet.field}, dòng ${sourceRow}: Error Type "${importedErrorTypeValue}" không nằm trong danh sách cho phép.`);
      }
      if (imported.editor && !imported.editorFreelancerId) {
        warnings.push(`${sheet.field}, dòng ${sourceRow}: không tìm thấy Editor "${imported.editor}" trong danh sách freelancer.`);
      }
      const fieldKey = String(sheet.field).trim().toLowerCase();
      const current = currentBySourceKey.get(`${fieldKey}:${sourceRow}`)
        || currentByFallbackKey.get(`${fieldKey}:${String(imported.title).trim()}:${String(imported.chapter).trim()}:${String(imported.error).trim()}`);
      if (current && getErrorScreenshotValues(current.screenshot).length > 1 && getErrorScreenshotValues(imported.screenshot).length < 2) {
        // A Google Sheet cell cannot faithfully represent several app screenshots.
        // Keep the local multi-image value during a Sheet sync instead of dropping
        // images down to the one image that the Sheet can expose.
        imported.screenshot = current.screenshot;
      }
      if (getErrorSheetHeaderIndex(sheet.headerIndex, 'errorType') === undefined && current?.errorType) {
        imported.errorType = current.errorType;
      }
      if (getErrorSheetHeaderIndex(sheet.headerIndex, 'screenshot') === undefined && current?.screenshot) {
        imported.screenshot = current.screenshot;
      }
      if (getErrorSheetHeaderIndex(sheet.headerIndex, 'fixCheck') === undefined && current) {
        imported.fixCheck = current.fixCheck;
      }
      importedRows.push({ imported, current });
    }

    const writeResults = await runWithConcurrency(importedRows, async ({ imported, current }) => {
      const storedImported = {
        ...imported,
        screenshot: await materializeErrorScreenshot(imported.screenshot, current?.id || `sheet-pending/${crypto.randomUUID()}`)
      };
      if (current) {
        if (!hasErrorSheetChanges(current, storedImported)) return 'unchanged';
        await updateRowById('errors', current.id, storedImported, ['field', 'title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editor', 'editorFreelancerId', 'fixCheck', 'sourceRow', 'sourceUrl', 'updatedAt']);
        const nextPaths = new Set(getStoragePathsFromErrorScreenshot(storedImported.screenshot));
        const obsoletePaths = getStoragePathsFromErrorScreenshot(current.screenshot).filter((path) => !nextPaths.has(path));
        if (obsoletePaths.length > 0) void removeErrorScreenshots(obsoletePaths).catch((error) => console.error('Không thể dọn screenshot cũ sau khi đồng bộ:', error.message));
        return 'updated';
      }
      await insertRow('errors', { ...storedImported, createdAt: storedImported.updatedAt }, ['field', 'title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editor', 'editorFreelancerId', 'fixCheck', 'sourceRow', 'sourceUrl', 'createdAt', 'updatedAt']);
      return 'inserted';
    });
    inserted += writeResults.filter((result) => result === 'inserted').length;
    updated += writeResults.filter((result) => result === 'updated').length;
  }

  const rowsAfterImport = await getCollection('errors');
  for (const row of rowsAfterImport.filter((item) => canManagerManageField(user, item.field) && item.sourceRow)) {
    const sourceKeys = sourceKeysByField.get(String(row.field).toLowerCase());
    if (sourceKeys && !sourceKeys.has(Number(row.sourceRow))) {
      await deleteRowById('errors', row.id);
      deleted += 1;
    }
  }

  return {
    inserted,
    updated,
    deleted,
    skipped,
    total: (await getCollection('errors')).filter((row) => canManagerManageField(user, row.field)).length,
    warnings: warnings.slice(0, 30),
    syncedAt: new Date().toISOString()
  };
}

function getTaskStatus(task) {
  const value = String(task?.status || task?.statusRaw || '').trim().toLowerCase();
  if (value === 'doing' || /đang thực hiện|đang làm/.test(value)) return 'doing';
  if (value === 'submitted' || /đã gửi|chờ qc/.test(value)) return 'submitted';
  if (value === 'done' || /hoàn thành|completed|complete/.test(value)) return 'done';
  return value;
}

function isFreelancerTaskComplete(task) {
  return ['submitted', 'done'].includes(getTaskStatus(task));
}

function getTaskDueTime(task) {
  const normalizedTask = task?.endTask ? normalizeDeadlineForResponse(task) : task;
  const value = normalizedTask?.endTask || normalizedTask?.deadline || normalizedTask?.dueDate;
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isTaskDueSoon(task, now = Date.now()) {
  const dueTime = getTaskDueTime(task);
  if (dueTime === null || ['submitted', 'checking', 'done'].includes(getTaskStatus(task))) return false;
  const dueDateKey = getCalendarDateKey(dueTime);
  const todayKey = getCalendarDateKey(now);
  const dueDay = Date.parse(`${dueDateKey}T00:00:00Z`);
  const today = Date.parse(`${todayKey}T00:00:00Z`);
  const daysUntilDue = Math.round((dueDay - today) / 86_400_000);
  return daysUntilDue >= 0 && daysUntilDue <= 3;
}

function getCalendarDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeDeadlineForResponse(deadline) {
  if (!deadline?.endTask) return deadline;
  try {
    return { ...deadline, endTask: normalizeDeadlineDueDate(deadline.endTask, 'Hạn DL') };
  } catch {
    return deadline;
  }
}

function decorateDeadlineTiming(deadline) {
  const normalizedDeadline = normalizeDeadlineForResponse(deadline);
  const storedSeconds = Math.max(0, Number(normalizedDeadline.workDurationSeconds || 0));
  const liveSeconds = normalizedDeadline.doingStartedAt && !normalizedDeadline.submittedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(normalizedDeadline.doingStartedAt).getTime()) / 1000))
    : 0;
  const workDurationSeconds = storedSeconds + liveSeconds;
  return {
    ...normalizedDeadline,
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

function buildImportedTimingTransition(current, nextStatus) {
  const currentStatus = getTaskStatus(current);
  if (currentStatus === nextStatus) {
    if (nextStatus === 'doing' && !current.doingStartedAt) {
      return {
        doingStartedAt: new Date().toISOString(),
        workDurationSeconds: Math.max(0, Number(current.workDurationSeconds || 0)),
        submittedAt: null
      };
    }
    if (nextStatus === 'submitted' && !current.submittedAt) {
      return {
        doingStartedAt: null,
        workDurationSeconds: Math.max(0, Number(current.workDurationSeconds || 0)),
        submittedAt: new Date().toISOString()
      };
    }
    return {
      doingStartedAt: current.doingStartedAt || null,
      workDurationSeconds: Math.max(0, Number(current.workDurationSeconds || 0)),
      submittedAt: current.submittedAt || null
    };
  }
  return buildStatusTransition(current, nextStatus);
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
  if (!partial || Object.prototype.hasOwnProperty.call(payload, 'textColor')) {
    const textColor = String(payload.textColor ?? '#FFFFFF').trim();
    if (!/^#[0-9a-f]{6}$/i.test(textColor)) throw validationError('Màu chữ phải ở định dạng HEX, ví dụ #FFFFFF.');
    result.textColor = textColor.toUpperCase();
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
  const defaultRow = rows.find((row) => !row.field) || {};
  const byField = Object.fromEntries(rows
    .filter((row) => row.field)
    .map((row) => [String(row.field), normalizeBonusSettingsRow(row)]));
  return {
    default: normalizeBonusSettingsRow(defaultRow),
    byField
  };
}

function normalizeBonusSettingsRow(row = {}) {
  return {
    id: row.id ?? null,
    field: row.field || null,
    taskThreshold: Number(row.taskThreshold ?? 20),
    bonusPerTask: Number(row.bonusPerTask ?? 10000),
    qcDefaultPrice: Number(row.qcDefaultPrice ?? 0),
    bonusPolicy: row.bonusPolicy || { versions: [] }
  };
}

function getBonusSettingsForField(settings, field) {
  const fieldName = String(field ?? '').trim();
  const fieldSettings = settings?.byField?.[fieldName]
    || (settings?.field ? settings : null)
    || settings?.default
    || settings
    || {};
  return {
    field: fieldName || fieldSettings.field || null,
    ...resolveBonusRule(fieldSettings)
  };
}

function buildSalaryRows(freelancers, deadlines, bonusSettings, month = null, undatedDeadlines = []) {
  return freelancers.map((freelancer) => {
    const freelancerId = freelancer.fIld ?? freelancer.fId ?? freelancer.id;
    const freelancerDeadlines = deadlines.filter((deadline) => (
      String(deadline.fIld ?? deadline.fId ?? deadline.freelancerId ?? '') === String(freelancerId)
    ));
    const completedTaskCount = freelancerDeadlines.filter(isFreelancerTaskComplete).length;
    const earnedAmount = freelancerDeadlines.reduce((total, deadline) => total + getDeadlineEarning(deadline), 0);
    const tasksByField = new Map();
    freelancerDeadlines.forEach((deadline) => {
      const field = deadline.type || '';
      if (!tasksByField.has(field)) tasksByField.set(field, []);
      // Approval, not the workflow status, selects chapters for the bonus milestone.
      tasksByField.get(field).push(deadline);
    });
    const bonusByField = [...tasksByField.entries()].map(([field, tasks]) => ({
      field,
      ...calculateBonus(tasks, getBonusSettingsForField(bonusSettings, field))
    }));
    const bonus = bonusByField.reduce((sum, summary) => sum + Math.round(summary.total * 100), 0) / 100;
    const bonusTaskCount = bonusByField.reduce((sum, summary) => sum + summary.after.rewardedCount, 0);
    const missingDateChapters = undatedDeadlines.filter((deadline) => String(deadline.fIld ?? deadline.fId ?? deadline.freelancerId ?? '') === String(freelancerId))
      .map((deadline) => ({ seriesId: deadline.seriesId, chapterNumber: deadline.chapterNumber, field: deadline.type }));

    return {
      ...freelancer,
      isQc: false,
      salaryMonth: month,
      missingDateChapters,
      earnedAmount: earnedAmount.toFixed(2),
      completedTaskCount,
      bonusTaskCount,
      bonus: bonus.toFixed(2),
      totalSalary: (earnedAmount + bonus).toFixed(2),
      bonusByField
    };
  });
}

function mergeQCSalaryProfiles(qcs) {
  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const hasId = (value) => value !== null && value !== undefined && value !== '';
  const accountQcs = qcs.filter((qc) => hasId(qc.accountId));
  const legacyQcs = qcs.filter((qc) => !hasId(qc.accountId));
  const merged = accountQcs.map((qc) => ({ ...qc, qcIds: [qc.qcId ?? qc.id] }));

  legacyQcs.forEach((legacy) => {
    const name = normalize(legacy.name || legacy.displayName || legacy.username);
    const email = normalize(legacy.email);
    const candidates = accountQcs.filter((account) => {
      if (hasId(legacy.freelancerId) && hasId(account.freelancerId)) {
        return String(legacy.freelancerId) === String(account.freelancerId);
      }
      const accountEmail = normalize(account.email);
      if (email && accountEmail) return email === accountEmail;
      return name && normalize(account.name || account.displayName || account.username) === name
        && accountQcs.filter((qc) => normalize(qc.name || qc.displayName || qc.username) === name).length === 1
        && legacyQcs.filter((qc) => normalize(qc.name || qc.displayName || qc.username) === name).length === 1;
    });
    if (candidates.length !== 1) {
      merged.push({ ...legacy, qcIds: [legacy.qcId ?? legacy.id] });
      return;
    }
    const account = candidates[0];
    const index = merged.findIndex((qc) => String(qc.accountId) === String(account.accountId));
    const current = merged[index];
    const fields = [...new Set([
      ...(Array.isArray(current.fields) ? current.fields : []), current.field,
      ...(Array.isArray(legacy.fields) ? legacy.fields : []), legacy.field
    ].filter(Boolean))];
    merged[index] = {
      ...legacy,
      ...current,
      fields,
      field: current.field || legacy.field || fields[0] || null,
      email: current.email || legacy.email || null,
      imageQR: current.imageQR || legacy.imageQR || null,
      qcIds: [...new Set([...current.qcIds, legacy.qcId ?? legacy.id])]
    };
  });
  return merged;
}

function buildQCSalaryRows(qcs, deadlines, bonusSettings, month = null) {
  return qcs.map((qc) => {
    const qcId = qc.qcId ?? qc.id;
    const qcIds = new Set((qc.qcIds || [qcId]).map(String));
    const qcDeadlines = deadlines.filter((deadline) => (
      qcIds.has(String(deadline.qcId ?? ''))
    ));
    const baseAmount = qcDeadlines.reduce((total, deadline) => total + getBonusSettingsForField(bonusSettings, deadline.type).qcDefaultPrice, 0);
    const transferredAmount = qcDeadlines.reduce((total, deadline) => total + getIncompleteCompletionTransfer(deadline), 0);

    return {
      ...qc,
      qcId,
      id: qc.id ?? qcId,
      name: qc.name || qc.displayName || qc.username || `QC ${qcId}`,
      fields: Array.isArray(qc.fields) && qc.fields.length > 0 ? qc.fields : (qc.field ? [qc.field] : []),
      isQc: true,
      salaryMonth: month,
      taskCount: qcDeadlines.length,
      earnedAmount: baseAmount.toFixed(2),
      transferredAmount: transferredAmount.toFixed(2),
      bonus: '0.00',
      totalSalary: (baseAmount + transferredAmount).toFixed(2),
      qcDefaultPrice: null
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

function getIncompleteCompletionTransfer(deadline) {
  const price = Number(deadline.price);
  const completionPercent = Number(deadline.completionPercent ?? 100);
  if (!Number.isFinite(price) || !Number.isFinite(completionPercent) || completionPercent >= 100) return 0;
  return price * Math.max(0, 100 - completionPercent) / 100;
}

function validateDeadlineCreatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu deadline không hợp lệ.');

  const seriesId = Number(payload.seriesId);
  const chapterNumber = String(payload.chapterNumber ?? '').trim();
  if (!Number.isInteger(seriesId) || seriesId < 0) throw validationError('ID bộ truyện phải là số nguyên không âm.');
  if (!chapterNumber || chapterNumber.length > 100) throw validationError('Chapter không được để trống và tối đa 100 ký tự.');

  const type = String(payload.type ?? '').trim();
  const difficultyText = String(payload.difficulty ?? '').trim();
  normalizeConfiguredFieldName(type);
  if (difficultyText.length > 100) throw validationError('Độ khó tối đa 100 ký tự.');

  const completionPercent = payload.completionPercent === null || payload.completionPercent === undefined || payload.completionPercent === ''
    ? 100
    : Number(payload.completionPercent);
  if (!Number.isInteger(completionPercent) || completionPercent < 0 || completionPercent > 200) {
    throw validationError('% hoàn thành phải là số nguyên từ 0 đến 200.');
  }

  const status = validateTaskStatus(payload.status);
  const submittedAt = normalizeDeadlineDate(payload.submittedAt, 'Ngày nộp');
  const freelancerId = nullableInteger(payload.fIld, 'Freelancer');
  const endTask = normalizeDeadlineDueDate(payload.endTask, 'Hạn DL');

  return {
    seriesId,
    chapterNumber,
    endTask,
    receivedAt: new Date().toISOString(),
    submittedAt: status === 'submitted' ? (submittedAt || new Date().toISOString()) : submittedAt,
    seriesName: nullableText(payload.seriesName),
    type,
    status,
    doingStartedAt: null,
    workDurationSeconds: 0,
    statusRaw: nullableText(payload.statusRaw) || 'Đang thực hiện',
    urlSeries: nullableText(payload.urlSeries),
    fIld: freelancerId,
    assignedAt: freelancerId === null ? null : new Date().toISOString(),
    assignedAdminId: nullableInteger(payload.assignedAdminId, 'Admin'),
    qcId: nullableInteger(payload.qcId, 'QC'),
    difficulty: difficultyText || null,
    feedback: nullableText(payload.feedback),
    late: normalizeLateValue(payload.late),
    paymentApproved: false,
    completionPercent
  };
}

function nullableText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeErrorType(value, { required = false } = {}) {
  const text = String(value ?? '').trim();
  const normalized = ERROR_TYPE_OPTIONS.find((option) => option.toLowerCase() === text.toLowerCase()) || null;
  if (!normalized && required) {
    throw validationError(`Error Type phải là một trong: ${ERROR_TYPE_OPTIONS.join(', ')}.`);
  }
  return normalized;
}

async function validateErrorPayload(payload, user) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu lỗi không hợp lệ.');
  const field = normalizeConfiguredFieldName(payload.field);
  assertManagerCanManageField(user, field);
  await assertConfiguredFields([field]);
  const title = String(payload.title ?? '').trim();
  const chapter = String(payload.chapter ?? '').trim();
  const errorType = normalizeErrorType(payload.errorType, { required: true });
  const errorText = String(payload.error ?? '').trim();
  if (!title || title.length > 255) throw validationError('Title không được để trống và tối đa 255 ký tự.');
  if (!chapter || chapter.length > 100) throw validationError('Chapter không được để trống và tối đa 100 ký tự.');
  if (!errorText) throw validationError('Error không được để trống.');
  const freelancers = await getCollection('freelancers');
  const editor = resolveErrorEditor(payload.editorFreelancerId ?? payload.editor, freelancers);
  if (!editor.id) throw validationError('Editor phải là một freelancer đã có trong hệ thống.');
  return {
    field,
    title,
    chapter,
    errorType,
    screenshot: normalizeErrorScreenshot(payload.screenshot, { strict: true }),
    error: errorText,
    note: nullableText(payload.note),
    editor: editor.name,
    editorFreelancerId: Number(editor.id)
  };
}

async function validateErrorUpdatePayload(payload, user, current) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu cập nhật lỗi không hợp lệ.');
  assertManagerCanManageField(user, current.field);
  const updates = {};
  const nextField = Object.prototype.hasOwnProperty.call(payload, 'field')
    ? normalizeConfiguredFieldName(payload.field)
    : current.field;
  assertManagerCanManageField(user, nextField);
  if (Object.prototype.hasOwnProperty.call(payload, 'field')) {
    await assertConfiguredFields([nextField]);
    updates.field = nextField;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = String(payload.title ?? '').trim();
    if (!title || title.length > 255) throw validationError('Title không được để trống và tối đa 255 ký tự.');
    updates.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'chapter')) {
    const chapter = String(payload.chapter ?? '').trim();
    if (!chapter || chapter.length > 100) throw validationError('Chapter không được để trống và tối đa 100 ký tự.');
    updates.chapter = chapter;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'errorType')) {
    updates.errorType = normalizeErrorType(payload.errorType, { required: true });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'screenshot')) {
    updates.screenshot = normalizeErrorScreenshot(payload.screenshot, { strict: true });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'error')) {
    const errorText = String(payload.error ?? '').trim();
    if (!errorText) throw validationError('Error không được để trống.');
    updates.error = errorText;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'note')) updates.note = nullableText(payload.note);
  if (Object.prototype.hasOwnProperty.call(payload, 'fixCheck')) updates.fixCheck = parseBooleanInput(payload.fixCheck, 'Fix/Check');
  if (Object.prototype.hasOwnProperty.call(payload, 'editor') || Object.prototype.hasOwnProperty.call(payload, 'editorFreelancerId')) {
    const freelancers = await getCollection('freelancers');
    const editor = resolveErrorEditor(payload.editorFreelancerId ?? payload.editor, freelancers);
    if (!editor.id) throw validationError('Editor phải là một freelancer đã có trong hệ thống.');
    updates.editor = editor.name;
    updates.editorFreelancerId = Number(editor.id);
  }
  if (Object.keys(updates).length === 0) throw validationError('Cần có ít nhất một trường để cập nhật lỗi.');
  return updates;
}

function validateFreelancerErrorUpdatePayload(payload, current, user) {
  if (String(current.editorFreelancerId ?? '') !== String(user.freelancerId ?? '')) {
    throw authorizationError('Bạn chỉ được cập nhật lỗi được giao cho mình.');
  }
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu cập nhật lỗi không hợp lệ.');
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'fixCheck')) updates.fixCheck = parseBooleanInput(payload.fixCheck, 'Fix/Check');
  const unsupported = Object.keys(payload).filter((key) => key !== 'fixCheck');
  if (unsupported.length > 0) throw authorizationError('Freelancer chỉ được cập nhật Fix/Check.');
  if (Object.keys(updates).length === 0) throw validationError('Cần có Fix/Check để cập nhật.');
  return updates;
}

function parseBooleanInput(value, label) {
  if (typeof value === 'boolean') return value;
  if ([true, 1, '1', 'true', 'yes', 'y', 'done', 'checked', 'fix'].includes(value)) return true;
  if ([false, 0, '0', 'false', 'no', 'n', ''].includes(value)) return false;
  throw validationError(`${label} phải là checkbox hợp lệ.`);
}

const LATE_OPTIONS = ['≤0h', '1~3h', '3~6h', '6~10h', '>10h'];

function normalizeLateValue(value, { strict = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return LATE_OPTIONS[0];

  const normalized = text.toLowerCase().replace(/\s+/g, '');
  const aliases = {
    '≤0h': '≤0h',
    '<=0h': '≤0h',
    '0h': '≤0h',
    '1-3h': '1~3h',
    '1~3h': '1~3h',
    '3-6h': '3~6h',
    '3~6h': '3~6h',
    '6-10h': '6~10h',
    '6~10h': '6~10h',
    '>10h': '>10h'
  };
  const result = aliases[normalized];
  if (result) return result;
  if (strict) throw validationError('Late chỉ được chọn một trong: ≤0h, 1~3h, 3~6h, 6~10h hoặc >10h.');
  return LATE_OPTIONS[0];
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function normalizeUrlSeries(value) {
  const text = String(value ?? '').trim();
  return isHttpUrl(text) ? text : null;
}

function nullableInteger(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw validationError(label + ' phải là số nguyên không âm.');
  return number;
}

async function assertAdminAssignment(adminId) {
  if (adminId === null || adminId === undefined || adminId === '') return;
  const accounts = await getCollection('accounts');
  const account = accounts.find((item) => String(item.id) === String(adminId) && hasAccountRole(item, 'Admin') && item.isActive !== false);
  if (!account) throw validationError('Tài khoản Admin được giao không tồn tại hoặc đã bị khóa.');
}

function nullableField(value, role) {
  const field = String(value ?? '').trim();
  if (!field) {
    if (hasAnyRole(role, ['Freelancer', 'QC'])) throw validationError('Account Freelancer/QC phải chọn ít nhất một mảng đã cấu hình.');
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
  if (hasAnyRole(role, ['Freelancer', 'QC']) && fields.length === 0) {
    throw validationError('Account Freelancer/QC phải chọn ít nhất một mảng đã cấu hình.');
  }
  return fields;
}

function normalizeDeadlineEndOfDayFromParts(year, month, day, label) {
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const dateText = `${String(yearNumber).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
  const date = new Date(`${dateText}T23:59:59.999${DEADLINE_TIME_ZONE_OFFSET}`);
  const isValidDate = Number.isFinite(date.getTime())
    && date.getUTCFullYear() === yearNumber
    && date.getUTCMonth() + 1 === monthNumber
    && date.getUTCDate() === dayNumber;
  if (!isValidDate) throw validationError(label + ' không hợp lệ.');
  return date.toISOString();
}

function getVietnamCalendarDateParts(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(label + ' không hợp lệ.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEADLINE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { year: values.year, month: values.month, day: values.day };
}

function normalizeDeadlineDueDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return normalizeDeadlineEndOfDayFromParts(dateOnly[1], dateOnly[2], dateOnly[3], label);
  const parts = getVietnamCalendarDateParts(value, label);
  return normalizeDeadlineEndOfDayFromParts(parts.year, parts.month, parts.day, label);
}

function normalizeDeadlineDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(label + ' không hợp lệ.');
  return date.toISOString();
}

function validateBonusSettingsPayload(payload) {
  const rule = validateBonusRule(payload);
  return { field: normalizeConfiguredFieldName(payload.field), rule };
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function authorizationError(message) {
  const error = new Error(message);
  error.statusCode = 403;
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
  const now = Date.now();
  if (!session || session.expiresAt < now) {
    if (token) sessions.delete(token);
    return null;
  }
  session.expiresAt = now + SESSION_TTL_MS;
  session.lastSeenAt = now;
  const requestedRole = String(req.headers['x-active-role'] || '').trim();
  const accountRoles = getAccountRoles(session.user);
  if (!requestedRole || !accountRoles.includes(requestedRole) || requestedRole === session.user.role) return session.user;
  return { ...session.user, role: requestedRole };
}

function getOnlineAccountIds() {
  const now = Date.now();
  const onlineAccountIds = new Set();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
      continue;
    }
    if (now - Number(session.lastSeenAt || 0) <= PRESENCE_TTL_MS && session.user?.id !== undefined && session.user?.id !== null) {
      onlineAccountIds.add(String(session.user.id));
    }
  }

  return onlineAccountIds;
}

function cleanupPasswordResetChallenges() {
  const now = Date.now();
  for (const [key, challenge] of passwordResetChallenges.entries()) {
    if (challenge.expiresAt <= now) passwordResetChallenges.delete(key);
  }
}

function hashPasswordResetOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function verifyPasswordResetOtp(otp, expectedHash) {
  const actual = Buffer.from(hashPasswordResetOtp(otp), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function maskEmail(email) {
  const [localPart, domain = ''] = String(email).split('@');
  if (!localPart || !domain) return 'email đã đăng ký';
  const visibleStart = localPart.slice(0, 1);
  const visibleEnd = localPart.length > 2 ? localPart.slice(-1) : '';
  return `${visibleStart}${'*'.repeat(Math.max(2, localPart.length - visibleStart.length - visibleEnd.length))}${visibleEnd}@${domain}`;
}

async function sendPasswordResetOtp(email, otp) {
  const config = getMailConfig();
  const { from } = config;
  const safeOtp = String(otp);
  await sendEmail({
    from, to: [email], subject: 'Mã OTP đặt lại mật khẩu - WZ System',
    text: `Mã OTP đặt lại mật khẩu của bạn là ${safeOtp}. Mã có hiệu lực trong 10 phút và chỉ sử dụng một lần. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033"><h2>Đặt lại mật khẩu WZ System</h2><p>Mã OTP của bạn là:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px;color:#2563eb">${safeOtp}</p><p>Mã có hiệu lực trong 10 phút và chỉ sử dụng một lần.</p><p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p></div>`
  }, { config });
}

function hasFreelancerAssignment(row) {
  return [row?.fId, row?.fIld, row?.freelancerId]
    .some((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function filterRowsForUser(rows, user) {
  if (user?.role === 'QC') {
    const allowedFields = normalizeStoredFields(user.fields, user.field).map((field) => field.toLowerCase());
    if (allowedFields.length === 0) return [];
    return rows.filter((row) => allowedFields.includes(String(row.type ?? '').trim().toLowerCase()));
  }
  if (user?.role !== 'Freelancer') return rows;
  if (user.freelancerId === null || user.freelancerId === undefined || user.freelancerId === '') return [];
  return rows.filter((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === String(user.freelancerId));
}

function filterFreelancerRowsForUser(rows, user) {
  if (user?.role === 'Admin') return rows;
  if (user?.role === 'QC') {
    const allowedFields = normalizeStoredFields(user.fields, user.field).map((field) => field.toLowerCase());
    return rows.filter((row) => {
      const rowFields = normalizeStoredFields(row.fields, row.field).map((field) => field.toLowerCase());
      return rowFields.some((field) => allowedFields.includes(field));
    });
  }
  if (user?.role === 'Freelancer') {
    return rows.filter((row) => String(getFreelancerId(row)) === String(user.freelancerId ?? ''));
  }
  return [];
}

function toPublicDeadlineRegistration(row, freelancer) {
  const fields = normalizeStoredFields(freelancer?.fields, freelancer?.field);
  return {
    ...row,
    fIld: row.fIld ?? row.fId ?? row.freelancerId ?? null,
    name: freelancer?.name || row.name || '',
    field: fields[0] || '',
    fields
  };
}

function filterDeadlineRegistrationRowsForUser(rows, user) {
  if (['Admin', 'QC'].includes(user?.role)) return rows;
  if (user?.role === 'Freelancer') {
    return rows.filter((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === String(user.freelancerId ?? ''));
  }
  return [];
}

function canManagerManageField(user, field) {
  if (user?.role === 'Admin') return true;
  if (user?.role !== 'QC') return false;
  const allowedFields = normalizeStoredFields(user.fields, user.field).map((item) => item.toLowerCase());
  return allowedFields.includes(String(field ?? '').trim().toLowerCase());
}

function assertManagerCanManageField(user, field) {
  if (!canManagerManageField(user, field)) {
    throw authorizationError('Bạn không có quyền quản lý lỗi của mảng này.');
  }
}

function filterErrorRowsForUser(rows, user) {
  if (user?.role === 'Admin') return rows;
  if (user?.role === 'QC') {
    const allowedFields = normalizeStoredFields(user.fields, user.field).map((field) => field.toLowerCase());
    return rows.filter((row) => allowedFields.includes(String(row.field ?? '').trim().toLowerCase()));
  }
  if (user?.role === 'Freelancer') {
    return rows.filter((row) => String(row.editorFreelancerId ?? '') === String(user.freelancerId ?? ''));
  }
  return [];
}

function filterSalaryRowsForUser(rows, user) {
  if (user?.role === 'Admin') return rows;
  if (['Freelancer', 'QC'].includes(user?.role)) {
    if (user.freelancerId === null || user.freelancerId === undefined || user.freelancerId === '') return [];
    return rows.filter((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === String(user.freelancerId));
  }
  return [];
}

function filterQCSalaryRowsForUser(rows, user) {
  if (user?.role === 'Admin') return rows;
  if (user?.role !== 'QC') return [];
  return rows.filter((row) => (
    String(row.qcId ?? row.id ?? '') === String(user.id ?? '')
    || String(row.qcId ?? row.id ?? '') === String(user.freelancerId ?? '')
  ));
}

function filterSalaryDeadlinesForUser(rows, user) {
  if (user?.role === 'Admin') return rows;
  if (user?.role === 'Freelancer') {
    if (user.freelancerId === null || user.freelancerId === undefined || user.freelancerId === '') return [];
    return rows.filter((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === String(user.freelancerId));
  }
  if (user?.role === 'QC') {
    return rows.filter((row) => (
      String(row.qcId ?? '') === String(user.id ?? '')
      || String(row.qcId ?? '') === String(user.freelancerId ?? '')
    ));
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

function normalizeAccountRoles(rawRoles, fallbackRole = '') {
  const values = Array.isArray(rawRoles) && rawRoles.length > 0
    ? rawRoles
    : (rawRoles === undefined || rawRoles === null || rawRoles === '' ? [fallbackRole] : [rawRoles]);
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter((value) => ACCOUNT_ROLES.includes(value)))];
}

function getAccountRoles(accountOrRoles, fallbackRole = '') {
  if (Array.isArray(accountOrRoles)) return normalizeAccountRoles(accountOrRoles, fallbackRole);
  if (accountOrRoles && typeof accountOrRoles === 'object') {
    return normalizeAccountRoles(accountOrRoles.roles, accountOrRoles.role);
  }
  return normalizeAccountRoles(accountOrRoles, fallbackRole);
}

function getEffectiveRole(accountOrRoles) {
  const roles = getAccountRoles(accountOrRoles);
  return roles.sort((left, right) => ROLE_PRIORITY[right] - ROLE_PRIORITY[left])[0] || 'Freelancer';
}

function hasAnyRole(accountOrRoles, roles) {
  const accountRoles = getAccountRoles(accountOrRoles);
  return roles.some((role) => accountRoles.includes(role));
}

function hasAccountRole(accountOrRoles, role) {
  return hasAnyRole(accountOrRoles, [role]);
}

function validateRoleFields(roles, fields) {
  if (hasAnyRole(roles, ['Freelancer', 'QC']) && fields.length === 0) {
    throw validationError('Account Freelancer/QC phải chọn ít nhất một mảng đã cấu hình.');
  }
  if (hasAccountRole(roles, 'Freelancer') && !hasAccountRole(roles, 'QC') && fields.length > 1) {
    throw validationError('Freelancer chỉ được chọn một mảng.');
  }
}

function toPublicAccount(account, freelancers = []) {
  const linkedFreelancer = freelancers.find((freelancer) => String(freelancer.fIld ?? freelancer.fId ?? freelancer.id) === String(account.freelancerId ?? ''));
  const accountFields = normalizeStoredFields(account.fields, account.field);
  const fields = accountFields.length > 0 ? accountFields : normalizeStoredFields(linkedFreelancer?.fields, linkedFreelancer?.field);
  const roles = getAccountRoles(account);
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    email: account.email || '',
    role: getEffectiveRole(roles),
    roles,
    field: fields[0] || '',
    fields,
    freelancerId: account.freelancerId ?? null,
    freelancerName: linkedFreelancer?.name || '',
    avatar: account.avatar || '',
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
  const roles = normalizeAccountRoles(payload.roles, payload.role);
  const role = getEffectiveRole(roles);
  const fields = normalizeAccountFields(payload.fields, payload.field, roles);
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw validationError('Username dài 3-50 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  if (password.length < 6) throw validationError('Password phải có ít nhất 6 ký tự.');
  if (roles.length === 0) throw validationError('Phải chọn ít nhất một role hợp lệ.');
  if (roles.length > 2) throw validationError('Mỗi account chỉ được có tối đa hai role.');
  if (!displayName || displayName.length > 150) throw validationError('Họ và tên không được để trống và tối đa 150 ký tự.');
  if (email && email.length > 255) throw validationError('Email không hợp lệ.');
  validateRoleFields(roles, fields);
  return { username, password, displayName, email, role, roles, field: fields[0] || null, fields, freelancerId: null };
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

function validateDeadlineRegistrationPayload(payload, { forcedFreelancerId = undefined } = {}) {
  if (!payload || typeof payload !== 'object') throw validationError('Dữ liệu đăng ký deadline không hợp lệ.');
  const fIld = forcedFreelancerId !== undefined
    ? nullableInteger(forcedFreelancerId, 'FLID')
    : nullableInteger(payload.fIld ?? payload.fId ?? payload.freelancerId, 'FLID');
  const chaptersPerWeek = nullableInteger(payload.chaptersPerWeek, 'Số chap 1 tuần nhận được');
  const chaptersPerMonth = nullableInteger(payload.chaptersPerMonth, 'Số chap 1 tháng');
  const stability = String(payload.stability ?? '').trim();
  if (fIld === null) throw validationError('FLID không được để trống.');
  if (chaptersPerWeek === null) throw validationError('Số chap 1 tuần nhận được không được để trống.');
  if (chaptersPerMonth === null) throw validationError('Số chap 1 tháng không được để trống.');
  if (!DEADLINE_REGISTRATION_STABILITY_OPTIONS.includes(stability)) {
    throw validationError(`Độ ổn định phải là một trong: ${DEADLINE_REGISTRATION_STABILITY_OPTIONS.join(', ')}.`);
  }
  return {
    fIld,
    chaptersPerWeek,
    chaptersPerMonth,
    stability: stability || null,
    note: nullableText(payload.note)
  };
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
  if (Object.prototype.hasOwnProperty.call(payload, 'roles') || Object.prototype.hasOwnProperty.call(payload, 'role')) {
    const roles = normalizeAccountRoles(payload.roles, payload.role);
    if (roles.length === 0) throw validationError('Phải chọn ít nhất một role hợp lệ.');
    if (roles.length > 2) throw validationError('Mỗi account chỉ được có tối đa hai role.');
    result.roles = roles;
    result.role = getEffectiveRole(roles);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'field')) {
    result.field = nullableField(payload.field, result.roles || getAccountRoles(current));
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'fields')) {
    result.fields = normalizeAccountFields(payload.fields, payload.field, result.roles || getAccountRoles(current));
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
    result.isActive = payload.isActive === true || payload.isActive === 'true' || payload.isActive === 1 || payload.isActive === '1';
  }

  const nextRoles = result.roles || getAccountRoles(current);
  const nextRole = result.role || getEffectiveRole(nextRoles);
  const nextFields = Object.prototype.hasOwnProperty.call(result, 'fields')
    ? result.fields
    : normalizeAccountFields(current.fields, result.field ?? current.field, nextRole, true);
  if (hasAnyRole(nextRoles, ['Freelancer', 'QC']) && nextFields.length === 0) {
    throw validationError('Account Freelancer/QC phải chọn ít nhất một mảng đã cấu hình.');
  }
  if (hasAccountRole({ roles: nextRoles }, 'Freelancer') && !hasAccountRole({ roles: nextRoles }, 'QC') && nextFields.length > 1) {
    throw validationError('Freelancer chỉ được chọn một mảng.');
  }
  result.fields = hasAnyRole(nextRoles, ['Freelancer', 'QC']) ? nextFields : [];
  result.field = nextFields[0] || null;
  result.freelancerId = hasAnyRole(nextRoles, ['Freelancer', 'QC']) ? (current.freelancerId ?? null) : null;
  result.roles = nextRoles;
  result.role = nextRole;
  validateRoleFields(nextRoles, nextFields);

  if (Object.keys(result).length === 3 && Object.prototype.hasOwnProperty.call(result, 'freelancerId') && Object.prototype.hasOwnProperty.call(result, 'field') && Object.prototype.hasOwnProperty.call(result, 'fields') && !Object.prototype.hasOwnProperty.call(payload, 'role') && !Object.prototype.hasOwnProperty.call(payload, 'field') && !Object.prototype.hasOwnProperty.call(payload, 'fields')) {
    throw validationError('Cần có ít nhất một trường để cập nhật.');
  }
  return result;
}

async function assertFreelancerExists(freelancerId, role) {
  if (!hasAnyRole(role, ['Freelancer', 'QC'])) return;
  const freelancers = await getCollection('freelancers');
  const exists = freelancers.some((freelancer) => String(freelancer.fIld ?? freelancer.fId ?? freelancer.id) === String(freelancerId));
  if (!exists) throw validationError('Freelancer được liên kết không tồn tại.');
}

async function ensureFreelancerForAccount(account) {
  if (!hasAnyRole(account.roles || account.role, ['Freelancer', 'QC'])) return null;
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
  if (!hasAnyRole(account.roles || account.role, ['Freelancer', 'QC']) || account.freelancerId === null || account.freelancerId === undefined) return;
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
