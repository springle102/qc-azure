export function readReminderLink(search = '') {
  const params = new URLSearchParams(search);
  const seriesId = params.get('seriesId');
  const chapterNumber = params.get('chapterNumber');
  if (params.get('view') !== 'deadlines' || !seriesId?.trim() || !chapterNumber?.trim()
    || seriesId.length > 255 || chapterNumber.length > 255) return null;
  return { seriesId, chapterNumber };
}

export function isReminderTarget(task, target) {
  return Boolean(target) && String(task.seriesId) === target.seriesId && String(task.chapterNumber) === target.chapterNumber;
}
