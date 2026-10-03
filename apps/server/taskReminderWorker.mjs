import { randomUUID } from 'node:crypto';
import { buildReminderEmail, eligibleReminderTask, reminderAppUrl, reminderDueAt, reminderIdentity, reminderMilestone, validReminderEmail } from './taskReminderEmail.mjs';
import { getMailConfig, sendEmail } from './mailTransport.mjs';

export function validateReminderConfiguration(env = process.env) {
  return { ...getMailConfig(env), appUrl: reminderAppUrl(env.APP_PUBLIC_URL).href };
}

export async function validateReminderStore(store, config) {
  try {
    await store('list', { limit: 1, offset: 0 });
    if (config.provider === 'gmail' && (await store('capabilities'))?.providerSafetyVersion !== 1) throw new Error();
  } catch {
    throw Object.assign(new Error('Chưa sẵn sàng lưu lịch sử mail. Chạy migration 20261003_task_reminders.sql và 20261003_gmail_reminders.sql, rồi kiểm tra database.'), { statusCode: 503 });
  }
}

export function reminderPagination(query = {}) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error('limit phải từ 1–100 và offset phải là số nguyên không âm.'), { statusCode: 400 });
  }
  return { limit, offset };
}

export function createTaskReminderWorker({ selectRows, store, send = sendEmail, config = validateReminderConfiguration, now = Date.now, onError = (error) => console.error('Task reminders:', error.message) }) {
  let running = false;
  let timer;
  let stopped = false;
  const settingsEnabled = async () => (await selectRows('generalSettings', { fresh: true }))[0]?.taskRemindersEnabled === true;

  async function processDelivery(candidate, mailConfig) {
    const leaseToken = randomUUID();
    const delivery = await store('claim', { deliveryKey: candidate.deliveryKey, leaseToken });
    if (!delivery) return;
    const finish = (outcome) => store('finish', { deliveryKey: delivery.deliveryKey, leaseToken, ...outcome });
    try {
      const [enabled, tasks, freelancers] = await Promise.all([
        settingsEnabled(), selectRows('deadlines', { fresh: true }), selectRows('freelancers', { fresh: true })
      ]);
      if (!enabled || stopped) {
        // Keep the original mail and key so a later enable resumes safely.
        await finish({ status: 'retry', nextAttemptAt: new Date(now() + 60_000).toISOString(), lastError: 'Tạm dừng vì tính năng đã tắt.' });
        return;
      }
      const task = tasks.find((row) => String(row.seriesId) === delivery.seriesId && String(row.chapterNumber) === delivery.chapterNumber);
      const person = freelancers.find((row) => String(row.fIld ?? row.fId ?? row.id) === delivery.freelancerId);
      if (!task || !eligibleReminderTask(task) || String(task.fIld) !== delivery.freelancerId
        || Date.parse(reminderDueAt(task.endTask)) !== Date.parse(delivery.dueAt) || reminderMilestone(delivery.dueAt, now()) !== delivery.milestone) {
        await finish({ status: 'cancelled', lastError: 'Task đã nộp, bị xóa, đổi hạn/người nhận hoặc đã sang mốc khác.' });
        return;
      }
      if (!person || !validReminderEmail(person.email) || person.email.trim() !== delivery.email) {
        await finish({ status: 'skipped', lastError: 'Email thiếu, không hợp lệ hoặc đã thay đổi. Kiểm tra hồ sơ freelancer.' });
        return;
      }
      if ((delivery.provider || 'resend') !== mailConfig.provider || delivery.payload?.from !== mailConfig.from) {
        await finish({ status: 'needs_review', lastError: 'Dịch vụ hoặc địa chỉ gửi đã đổi. Kiểm tra lịch sử trước khi xử lý; không tự chuyển mail đang chờ sang tài khoản khác.' });
        return;
      }
      const providerMessageId = await send(delivery.payload, { idempotencyKey: `task-reminder/${delivery.deliveryKey}`, config: mailConfig, now: now() });
      // Gmail lease recovery stops for review; Resend recovery reuses its provider key.
      await finish({ status: 'sent', providerMessageId });
    } catch (error) {
      // Persistence failures have no retryable flag; do not reinterpret an accepted email as a failed send.
      if (error.retryable === undefined) throw error;
      const uncertain = delivery.uncertain || error.uncertain;
      const retry = error.retryable && delivery.attemptCount < 4 && !(mailConfig.provider === 'gmail' && uncertain);
      const delay = Math.max([60_000, 300_000, 900_000][delivery.attemptCount - 1] || 900_000, error.retryAfterMs || 0);
      await finish({
        status: retry ? 'retry' : uncertain ? 'needs_review' : 'failed',
        uncertain: Boolean(uncertain), lastError: error.message,
        nextAttemptAt: new Date(now() + delay).toISOString()
      });
    }
  }

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      if (!await settingsEnabled()) return;
      const mailConfig = config();
      if (mailConfig.provider === 'gmail') await validateReminderStore(store, mailConfig);
      const [tasks, freelancers] = await Promise.all([selectRows('deadlines', { fresh: true }), selectRows('freelancers', { fresh: true })]);
      const people = new Map(freelancers.map((row) => [String(row.fIld ?? row.fId ?? row.id), row]));
      const records = [];
      for (const task of tasks) {
        if (!eligibleReminderTask(task)) continue;
        const milestone = reminderMilestone(reminderDueAt(task.endTask), now());
        if (!milestone) continue;
        const person = people.get(String(task.fIld));
        const validEmail = validReminderEmail(person?.email);
        records.push({
          ...reminderIdentity(task, milestone), provider: mailConfig.provider, email: String(person?.email || '').trim(),
          payload: validEmail ? buildReminderEmail(task, person, milestone, { now: now(), from: mailConfig.from, appUrl: mailConfig.appUrl }) : null,
          status: validEmail ? 'pending' : 'skipped', lastError: validEmail ? '' : 'Freelancer chưa có email hợp lệ trong hồ sơ.'
        });
      }
      for (let i = 0; i < records.length; i += 100) await store('enqueue', { records: records.slice(i, i + 100) });
      for (const delivery of await store('pending')) {
        if (stopped) break;
        try { await processDelivery(delivery, mailConfig); } catch (error) { onError(error); }
      }
    } catch (error) { onError(error); } finally { running = false; }
  }

  return {
    tick,
    start() {
      if (timer) return;
      stopped = false;
      void tick();
      timer = setInterval(() => { void tick(); }, 60_000);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); timer = undefined; }
  };
}
