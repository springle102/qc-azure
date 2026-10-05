import test from 'node:test';
import assert from 'node:assert/strict';
import { isReminderTarget, readReminderLink, readNotificationView } from '../src/utils/reminderLink.mjs';

test('mail links preserve exact task identifiers through login and only match the intended row', () => {
  const target = readReminderLink('?view=deadlines&seriesId=42&chapterNumber=1%26A');
  assert.deepEqual(target, { seriesId: '42', chapterNumber: '1&A' });
  assert.equal(isReminderTarget({ seriesId: 42, chapterNumber: '1&A' }, target), true);
  assert.equal(isReminderTarget({ seriesId: 42, chapterNumber: '1A' }, target), false);
  assert.equal(isReminderTarget({ seriesId: 43, chapterNumber: '1&A' }, target), false);
  for (const search of ['', '?view=salary&seriesId=42&chapterNumber=1A', '?view=deadlines&seriesId=42', '?view=deadlines&seriesId=&chapterNumber=1A']) assert.equal(readReminderLink(search), null);
});

test('push links select the appropriate page through login and reject invalid targets', () => {
  assert.equal(readNotificationView('?view=errors&errorId=10'), 'errors');
  assert.equal(readNotificationView('?view=deadlines&seriesId=42&chapterNumber=1%26A'), 'deadlines');
  for (const search of ['', '?view=errors', '?view=errors&errorId=', '?view=errors&errorId=%20', '?view=salary&errorId=10', `?view=errors&errorId=${'a'.repeat(256)}`]) {
    assert.equal(readNotificationView(search), 'dashboard');
  }
});
