import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderEmail, eligibleReminderTask, reminderDueAt, reminderIdentity, reminderMilestone, validReminderEmail } from '../taskReminderEmail.mjs';
import { createTaskReminderWorker, reminderPagination, validateReminderConfiguration } from '../taskReminderWorker.mjs';
import { sendResendEmail } from '../mailTransport.mjs';

const HOUR = 3_600_000;
const task = { seriesId: 42, chapterNumber: '1A', seriesName: 'Bộ thử nghiệm', type: 'Japan', fIld: 9, endTask: '2026-10-05', status: 'Doing', submittedAt: null };
const person = { fIld: 9, name: 'An', email: 'an@example.com' };
const due = Date.parse(reminderDueAt(task.endTask));
const config = { provider: 'resend', apiKey: 'test-only', from: 'QC <qc@example.com>', appUrl: 'https://example.com/' };

test('Vietnam end-of-day cutoff and all four exact boundaries', () => {
  assert.equal(reminderDueAt('2026-10-05'), '2026-10-05T16:59:59.999Z');
  assert.equal(reminderDueAt('2026-10-05T18:00:00Z'), '2026-10-06T16:59:59.999Z');
  for (const value of [null, '', 'not-a-date', '2026-02-30', '2026-13-01']) assert.equal(reminderDueAt(value), null);
  for (const [delta, expected] of [[24 * HOUR + 1, null], [24 * HOUR, '24h'], [6 * HOUR + 1, '24h'], [6 * HOUR, '6h'], [3 * HOUR + 1, '6h'], [3 * HOUR, '3h'], [0, '3h'], [-1, 'overdue']]) {
    assert.equal(reminderMilestone(new Date(due).toISOString(), due - delta), expected);
  }
});

test('eligibility requires an assigned, identifiable, unsubmitted task', () => {
  for (const status of ['', null, 'doing', ' DOING ']) assert.equal(eligibleReminderTask({ ...task, status }), true);
  for (const status of ['submitted', 'checking', 'fixing', 'done', 'unknown']) assert.equal(eligibleReminderTask({ ...task, status }), false);
  for (const changes of [{ fIld: null }, { endTask: '' }, { chapterNumber: '' }, { seriesId: null }, { submittedAt: '2026-10-04T00:00:00Z' }]) assert.equal(eligibleReminderTask({ ...task, ...changes }), false);
  for (const value of ['', undefined, 'bad', 'a@example.com,b@example.com', 'x\n@example.com']) assert.equal(validReminderEmail(value), false);
  assert.equal(validReminderEmail(' an@example.com '), true);
});

test('all mail variants have safe HTML, plain text, one emoji and a task link', () => {
  const unsafeTask = { ...task, chapterNumber: '1&A', seriesName: '<img src=x onerror=alert(1)>' };
  for (const milestone of ['24h', '6h', '3h', 'overdue']) {
    const email = buildReminderEmail(unsafeTask, { ...person, name: '<script>name</script>' }, milestone, { ...config, now: due - 2 * HOUR });
    assert.deepEqual(email.to, [person.email]);
    assert.ok(email.text.includes('Đội ngũ QC — WZ System'));
    assert.ok(email.text.includes('23:59'));
    assert.equal((email.subject.match(/\p{Extended_Pictographic}/gu) || []).length, 1);
    assert.ok(!email.html.includes('<script>'));
    assert.ok(!email.html.includes('<img src=x'));
    assert.ok(email.html.includes('&lt;script&gt;'));
    const link = new URL(email.text.match(/https:\/\/example\.com\/[^\s]+/)[0]);
    assert.equal(link.searchParams.get('chapterNumber'), '1&A');
    assert.equal(link.searchParams.get('seriesId'), '42');
    assert.equal(link.searchParams.get('view'), 'deadlines');
    if (['6h', '3h'].includes(milestone)) assert.ok(email.text.includes('2 tiếng'));
  }
});

test('configuration and pagination reject invalid input without exposing credentials', () => {
  assert.throws(() => validateReminderConfiguration({}), /GMAIL_CLIENT_ID/);
  for (const APP_PUBLIC_URL of ['javascript:alert(1)', 'https://secret:password@example.com/', 'https://example.com/?view=x', '']) {
    assert.throws(() => validateReminderConfiguration({ MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test', RESEND_FROM: config.from, APP_PUBLIC_URL }), /APP_PUBLIC_URL/);
  }
  assert.deepEqual(reminderPagination(), { limit: 50, offset: 0 });
  for (const query of [{ limit: 101 }, { limit: 0 }, { offset: -1 }, { offset: 'NaN' }, { limit: ['1', '2'] }]) assert.throws(() => reminderPagination(query));
});

function harness({ time = due - 24 * HOUR, tasks = [{ ...task }], people = [{ ...person }], enabled = true } = {}) {
  const state = { time, tasks, people, enabled, deliveries: new Map(), sends: [], errors: [], failFinish: false };
  const store = async (action, data = {}) => {
    if (action === 'capabilities') return { providerSafetyVersion: 1 };
    if (action === 'list') return { items: [], total: state.deliveries.size };
    if (action === 'enqueue') {
      for (const item of data.records) {
        const old = state.deliveries.get(item.deliveryKey);
        if (!old || (old.status === 'skipped' && old.attemptCount === 0 && item.status === 'pending')) state.deliveries.set(item.deliveryKey, { ...structuredClone(item), attemptCount: 0, nextAttemptAt: state.time });
      }
      return {};
    }
    if (action === 'pending') return [...state.deliveries.values()].filter((item) => ['pending', 'retry', 'processing'].includes(item.status) && item.nextAttemptAt <= state.time && (!item.leaseUntil || item.leaseUntil <= state.time));
    const item = state.deliveries.get(data.deliveryKey);
    if (action === 'claim') {
      if (!item || !['pending', 'retry', 'processing'].includes(item.status) || item.leaseUntil > state.time || item.nextAttemptAt > state.time) return null;
      if (item.provider === 'gmail' && (item.status === 'processing' || item.uncertain)) { item.status = 'needs_review'; return null; }
      if (item.attemptCount >= 4 || (item.firstAttemptAt && item.firstAttemptAt <= state.time - 24 * HOUR)) {
        item.status = item.uncertain || item.status === 'processing' ? 'needs_review' : 'failed';
        return null;
      }
      Object.assign(item, { status: 'processing', leaseToken: data.leaseToken, leaseUntil: state.time + 120_000, attemptCount: item.attemptCount + 1, firstAttemptAt: item.firstAttemptAt || state.time });
      return structuredClone(item);
    }
    if (action === 'finish') {
      if (state.failFinish && data.status === 'sent') { state.failFinish = false; throw new Error('database temporarily unavailable'); }
      if (item.leaseToken !== data.leaseToken) return null;
      Object.assign(item, data, { nextAttemptAt: data.nextAttemptAt ? Date.parse(data.nextAttemptAt) : state.time, leaseUntil: null });
      return structuredClone(item);
    }
    throw new Error(`Unexpected operation: ${action}`);
  };
  const deps = {
    store, now: () => state.time, config: () => config, onError: (error) => state.errors.push(error),
    selectRows: async (collection, options) => {
      assert.equal(options.fresh, true);
      return collection === 'generalSettings' ? [{ taskRemindersEnabled: state.enabled }] : collection === 'deadlines' ? state.tasks : state.people;
    },
    send: async (payload, options) => { state.sends.push({ payload: structuredClone(payload), key: options.idempotencyKey }); return 'mail-test-id'; }
  };
  return { state, deps, worker: createTaskReminderWorker(deps) };
}

test('one separate mail per task per milestone, no repeated overdue mail', async () => {
  const { state, worker } = harness({ tasks: [{ ...task }, { ...task, chapterNumber: '2' }] });
  for (const delta of [24 * HOUR, 6 * HOUR, 3 * HOUR, -1]) {
    state.time = due - delta;
    await worker.tick();
    await worker.tick();
  }
  assert.equal(state.sends.length, 8);
  assert.equal(new Set(state.sends.map((item) => item.key)).size, 8);
  state.time += 3 * 24 * HOUR;
  await worker.tick();
  assert.equal(state.sends.length, 8);
});

test('Gmail retries confirmed rejections but stops uncertain sends and crashed leases', async () => {
  for (const failure of ['429', 'unknown', 'persistence']) {
    const { state, deps } = harness();
    deps.config = () => ({ ...config, provider: 'gmail' });
    const originalSend = deps.send;
    deps.send = async (...args) => {
      await originalSend(...args);
      if (failure === 'persistence') return 'accepted';
      throw Object.assign(new Error('gmail error'), { retryable: true, uncertain: failure === 'unknown' });
    };
    state.failFinish = failure === 'persistence';
    const worker = createTaskReminderWorker(deps);
    await worker.tick();
    state.time += 120_001;
    await worker.tick();
    assert.equal(state.sends.length, failure === '429' ? 2 : 1);
    assert.equal([...state.deliveries.values()][0].status, failure === '429' ? 'retry' : 'needs_review');
  }
});

test('switching mail provider or sender never sends an old queued payload', async () => {
  for (const change of [{ provider: 'gmail' }, { from: 'Other <other@example.com>' }]) {
    const { state, deps } = harness();
    deps.send = async () => { throw Object.assign(new Error('rejected'), { retryable: true, uncertain: false }); };
    await createTaskReminderWorker(deps).tick();
    deps.config = () => ({ ...config, ...change });
    deps.send = async () => { state.sends.push('unexpected'); };
    state.time += 60_001;
    await createTaskReminderWorker(deps).tick();
    assert.equal(state.sends.length, 0);
    assert.equal([...state.deliveries.values()][0].status, 'needs_review');
  }
});

test('Gmail refuses to enqueue or send without the provider safety migration', async () => {
  const { state, deps } = harness();
  deps.config = () => ({ ...config, provider: 'gmail' });
  const original = deps.store;
  deps.store = (action, data) => action === 'capabilities' ? null : original(action, data);
  await createTaskReminderWorker(deps).tick();
  assert.equal(state.deliveries.size, 0);
  assert.match(state.errors[0].message, /20261003_gmail_reminders.sql/);
});

test('missed milestones and existing overdue tasks send only the current milestone', async () => {
  for (const [time, milestone] of [[due - 2 * HOUR, '3h'], [due + 10 * 24 * HOUR, 'overdue']]) {
    const { state, worker } = harness({ time });
    await worker.tick();
    assert.equal(state.sends.length, 1);
    assert.equal([...state.deliveries.values()][0].milestone, milestone);
  }
});

test('disabled reminders, invalid email and completed tasks never send', async () => {
  for (const options of [{ enabled: false }, { people: [{ ...person, email: '' }] }, { tasks: [{ ...task, status: 'Submitted' }] }]) {
    const { state, worker } = harness(options);
    await worker.tick();
    assert.equal(state.sends.length, 0);
  }
  const { state, worker } = harness({ people: [{ ...person, email: '' }] });
  await worker.tick();
  state.people[0].email = person.email;
  await worker.tick();
  assert.equal(state.sends.length, 1, 'correcting an email before any send resumes the current milestone');
});

test('final fresh read cancels tasks submitted/deleted/reassigned/rescheduled or moved to another milestone', async () => {
  for (const change of [(s) => { s.tasks[0].status = 'Submitted'; }, (s) => { s.tasks = []; }, (s) => { s.tasks[0].fIld = 10; }, (s) => { s.tasks[0].endTask = '2026-10-06'; }, (s) => { s.time = due - 2 * HOUR; }]) {
    const { state, deps } = harness();
    const originalStore = deps.store;
    deps.store = async (action, data) => {
      const result = await originalStore(action, data);
      if (action === 'claim' && result) change(state);
      return result;
    };
    await createTaskReminderWorker(deps).tick();
    assert.equal(state.sends.length, 0);
    assert.equal([...state.deliveries.values()][0].status, 'cancelled');
  }
});

test('overlapping ticks and two workers use one atomic claim', async () => {
  const { state, deps, worker } = harness();
  await Promise.all([worker.tick(), worker.tick(), createTaskReminderWorker(deps).tick()]);
  assert.equal(state.sends.length, 1);
});

test('three retries respect retry-after and freeze payload/idempotency key', async () => {
  const { state, deps } = harness();
  const originalSend = deps.send;
  deps.send = async (...args) => {
    await originalSend(...args);
    throw Object.assign(new Error('temporary failure'), { retryable: true, uncertain: true, retryAfterMs: 120_000 });
  };
  const worker = createTaskReminderWorker(deps);
  await worker.tick();
  state.time += 60_000;
  await worker.tick();
  assert.equal(state.sends.length, 1);
  for (const delay of [60_000, 300_000, 900_000]) { state.time += delay; await worker.tick(); }
  assert.equal(state.sends.length, 4);
  assert.ok(state.sends.every((item) => JSON.stringify(item) === JSON.stringify(state.sends[0])));
  assert.equal([...state.deliveries.values()][0].status, 'needs_review');
});

test('accepted email with failed persistence recovers the lease using the same mail/key', async () => {
  const { state, worker, deps } = harness();
  state.failFinish = true;
  await worker.tick();
  assert.equal([...state.deliveries.values()][0].status, 'processing');
  assert.equal(state.errors.length, 1);
  state.time += 120_001;
  await createTaskReminderWorker(deps).tick();
  assert.equal([...state.deliveries.values()][0].status, 'sent');
  assert.deepEqual(state.sends[0], state.sends[1]);
});

test('uncertain sends outside the provider 24-hour window are not sent again', async () => {
  const { state, worker, deps } = harness({ time: due + 1 });
  state.failFinish = true;
  await worker.tick();
  state.time += 24 * HOUR + 1;
  await createTaskReminderWorker(deps).tick();
  assert.equal(state.sends.length, 1);
  assert.equal([...state.deliveries.values()][0].status, 'needs_review');
});

test('editing the deadline or assignment creates a new identity', () => {
  const original = reminderIdentity(task, '24h').deliveryKey;
  assert.notEqual(reminderIdentity({ ...task, fIld: 10 }, '24h').deliveryKey, original);
  assert.notEqual(reminderIdentity({ ...task, endTask: '2026-10-06' }, '24h').deliveryKey, original);
});

test('transport handles acceptance, terminal errors, retryable failures and timeout', async () => {
  let request;
  const id = await sendResendEmail({ from: config.from, to: [person.email], subject: 'OTP', text: 'test' }, { config, idempotencyKey: 'test-key', fetchImpl: async (_url, options) => { request = options; return new Response(JSON.stringify({ id: 'accepted' }), { status: 200 }); } });
  assert.equal(id, 'accepted');
  assert.equal(request.headers['Idempotency-Key'], 'test-key');
  for (const [status, retryable, uncertain] of [[422, false, false], [429, true, false], [503, true, true]]) {
    await assert.rejects(sendResendEmail({}, { config, fetchImpl: async () => new Response(JSON.stringify({ message: 'test failure' }), { status, headers: { 'Retry-After': '120' } }) }), (error) => error.retryable === retryable && error.uncertain === uncertain && error.retryAfterMs === 120_000);
  }
  await assert.rejects(sendResendEmail({}, { config, fetchImpl: async () => { throw new Error('timeout'); } }), (error) => error.retryable && error.uncertain);
});
