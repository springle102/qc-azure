import { createHash } from 'node:crypto';

export const REMINDER_MILESTONES = ['24h', '6h', '3h', 'overdue'];
const HOUR = 3_600_000;
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function reminderDueAt(value) {
  if (!value) return null;
  const text = String(value).trim();
  let day = text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    day = `${fields.year}-${fields.month}-${fields.day}`;
  }
  const timestamp = Date.parse(`${day}T23:59:59.999+07:00`);
  if (!Number.isFinite(timestamp) || new Date(timestamp + 7 * HOUR).toISOString().slice(0, 10) !== day) return null;
  return new Date(timestamp).toISOString();
}

export function reminderMilestone(dueAt, now = Date.now()) {
  if (!dueAt) return null;
  const remaining = Date.parse(dueAt) - now;
  if (!Number.isFinite(remaining) || remaining > 24 * HOUR) return null;
  if (remaining < 0) return 'overdue';
  if (remaining <= 3 * HOUR) return '3h';
  if (remaining <= 6 * HOUR) return '6h';
  return '24h';
}

export function eligibleReminderTask(task) {
  return task?.fIld !== null && task?.fIld !== undefined && String(task.fIld).trim() !== ''
    && task?.seriesId !== null && task?.seriesId !== undefined && String(task.seriesId).trim() !== ''
    && task?.chapterNumber !== null && task?.chapterNumber !== undefined && String(task.chapterNumber).trim() !== ''
    && ['', 'doing'].includes(String(task.status ?? '').trim().toLowerCase())
    && !task.submittedAt && Boolean(reminderDueAt(task.endTask));
}

export function reminderIdentity(task, milestone) {
  const dueAt = reminderDueAt(task.endTask);
  const identity = [String(task.seriesId), String(task.chapterNumber), String(task.fIld), dueAt, milestone];
  return {
    deliveryKey: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
    seriesId: identity[0], chapterNumber: identity[1], freelancerId: identity[2], dueAt, milestone
  };
}

export function validReminderEmail(value) {
  return typeof value === 'string' && value.trim().length <= 254
    && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value.trim());
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function reminderAppUrl(value = process.env.APP_PUBLIC_URL) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url;
  } catch {
    throw Object.assign(new Error('Cần cấu hình APP_PUBLIC_URL là URL web hợp lệ (http/https, không chứa thông tin đăng nhập, query hoặc hash).'), { statusCode: 503 });
  }
}

const bold = (value) => ({ value: String(value), bold: true });
const paragraphText = (paragraph) => paragraph.map((part) => typeof part === 'string' ? part : part.value).join('');
const paragraphHtml = (paragraph) => paragraph.map((part) => typeof part === 'string' ? escapeHtml(part) : `<strong>${escapeHtml(part.value)}</strong>`).join('');

export function buildReminderEmail(task, freelancer, milestone, { now = Date.now(), from, appUrl } = {}) {
  if (!REMINDER_MILESTONES.includes(milestone)) throw new Error('Mốc nhắc không hợp lệ.');
  const dueAt = reminderDueAt(task.endTask);
  if (!dueAt) throw new Error('Hạn nộp không hợp lệ.');
  const title = String(task.seriesName || `Bộ ${task.seriesId}`).replace(/[\r\n]+/g, ' ');
  const chapter = String(task.chapterNumber).replace(/[\r\n]+/g, ' ');
  const taskTitle = `${title} — Chapter ${chapter}`;
  const due = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23' }).format(new Date(dueAt));
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(dueAt));
  const minutes = Math.max(0, Math.ceil((Date.parse(dueAt) - now) / 60_000));
  const remaining = minutes >= 60 ? `${Math.floor(minutes / 60)} tiếng${minutes % 60 ? ` ${minutes % 60} phút` : ''}` : `${minutes} phút`;
  const variants = {
    '24h': {
      subject: `👋 Ping nhẹ: ${taskTitle} sắp tới deadline`, button: 'Xem task của bạn',
      paragraphs: [
        ['Bên mình ping nhẹ một chiếc deadline: task dưới đây sẽ đến hạn vào ', bold(due), '.'],
        ['Bạn check tiến độ và dành thời gian hoàn thiện những phần còn lại nhé. Chốt file đúng hạn là cả bạn và team QC cùng có một pha về đích đẹp!'],
        ['Nếu có đoạn nào đang “kẹt”, bạn báo sớm cho QC/người giao task qua kênh làm việc hiện tại để cùng gỡ nhé.'],
        ['Cảm ơn bạn, hẹn gặp chiếc task hoàn thiện!']
      ]
    },
    '6h': {
      subject: `⏳ Bật mode về đích: ${taskTitle} sắp đến hạn`,
      paragraphs: [
        ['Đồng hồ đang đếm ngược: task dưới đây còn khoảng ', bold(remaining), ' trước hạn nộp.'],
        [bold('Bạn bật mode về đích, ưu tiên hoàn thiện các phần còn lại và kiểm tra file'), ' giúp bên mình nhé. Team QC đang chờ nhận task để tiếp tục theo lịch.'],
        ['Bàn giao xong, nhớ cập nhật ', bold('Submitted'), ' trên hệ thống để team nhận tín hiệu “đã chốt” từ bạn.'],
        ['Nếu thấy khó kịp hạn, bạn báo sớm tình hình và giờ dự kiến nộp cho QC/người giao task nhé.'],
        ['Cảm ơn bạn, cùng chốt task đúng hẹn nào!']
      ]
    },
    '3h': {
      subject: `🏁 Chặng cuối rồi: chốt ${taskTitle} trước ${time} nhé`,
      paragraphs: [
        ['Task đang vào chặng cuối, còn khoảng ', bold(remaining), ' trước deadline.'],
        ['Bạn ưu tiên hoàn tất, kiểm tra file và bàn giao ', bold(`trước ${due}`), ' giúp bên mình nhé. Team QC đang sẵn sàng nhận baton để chạy tiếp!'],
        ['Sau khi bàn giao, nhớ cập nhật ', bold('Submitted'), ' để hệ thống ghi nhận bạn đã nộp.'],
        ['Nếu có vướng mắc khiến bạn khó kịp giờ, hãy báo ngay cho QC/người giao task phần còn lại và thời gian dự kiến hoàn thành để team chủ động sắp xếp.'],
        ['Cảm ơn bạn, mong sớm nhận được tín hiệu “đã nộp”!']
      ]
    },
    overdue: {
      subject: `📌 ${taskTitle} đã quá hạn: bạn cập nhật tiến độ nhé`,
      paragraphs: [
        ['Deadline ', bold(due), ' đã qua, nhưng hệ thống vẫn chưa nhận được tín hiệu ', bold('Submitted'), ' cho task dưới đây.'],
        ['Bên mình xin bạn một chiếc cập nhật tiến độ nhé. ', bold('Bạn ưu tiên hoàn thiện và bàn giao sớm nhất có thể'), ', vì team QC đang cần task để tiếp tục công việc.'],
        ['Nếu chưa thể nộp ngay, bạn báo QC/người giao task phần còn lại và ', bold('thời gian dự kiến nộp cụ thể'), ' qua kênh làm việc hiện tại để team sắp xếp nhé.'],
        ['Nếu đã bàn giao rồi thì chỉ còn một bước: cập nhật ', bold('Submitted'), ' trên hệ thống giúp bên mình.'],
        ['Cảm ơn bạn, team chờ tin từ bạn nhé!']
      ]
    }
  };
  const variant = variants[milestone];
  const button = variant.button || 'Xem task và cập nhật trạng thái';
  const url = reminderAppUrl(appUrl);
  url.searchParams.set('view', 'deadlines');
  url.searchParams.set('seriesId', String(task.seriesId));
  url.searchParams.set('chapterNumber', String(task.chapterNumber));
  const greeting = `Chào ${freelancer?.name || 'bạn'},`;
  const details = `Task: ${taskTitle}\nMã bộ / Mảng: ${task.seriesId} / ${task.type || 'Chưa có mảng'}\nHạn nộp: ${due} — giờ Việt Nam`;
  const text = [greeting, details, ...variant.paragraphs.map(paragraphText), `${button}: ${url.href}`, 'Đội ngũ QC — WZ System'].join('\n\n');
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;background:#f3f5f9;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:auto;padding:24px;background:#fff;border-radius:12px;line-height:1.7;overflow-wrap:anywhere"><p>${escapeHtml(greeting)}</p><div style="padding:16px;background:#eef2ff;border-radius:8px"><strong>Task:</strong> ${escapeHtml(taskTitle)}<br><strong>Mã bộ / Mảng:</strong> ${escapeHtml(task.seriesId)} / ${escapeHtml(task.type || 'Chưa có mảng')}<br><strong>Hạn nộp: ${escapeHtml(due)}</strong> — giờ Việt Nam</div>${variant.paragraphs.map((paragraph) => `<p>${paragraphHtml(paragraph)}</p>`).join('')}<p><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:white;text-decoration:none;border-radius:8px">${escapeHtml(button)}</a></p><p style="font-size:13px;color:#64748b">Đội ngũ QC — WZ System</p></div></body></html>`;
  return { from, to: [String(freelancer.email).trim()], subject: variant.subject, text, html };
}
