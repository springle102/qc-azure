import test from 'node:test';
import assert from 'node:assert/strict';
import { isReminderTarget, readReminderLink } from '../src/utils/reminderLink.mjs';

test('mail links preserve exact task identifiers through login and only match the intended row', () => {
  const target = readReminderLink('?view=deadlines&seriesId=42&chapterNumber=1%26A');
  assert.deepEqual(target, { seriesId: '42', chapterNumber: '1&A' });
  assert.equal(isReminderTarget({ seriesId: 42, chapterNumber: '1&A' }, target), true);
  assert.equal(isReminderTarget({ seriesId: 42, chapterNumber: '1A' }, target), false);
  assert.equal(isReminderTarget({ seriesId: 43, chapterNumber: '1&A' }, target), false);
  for (const search of ['', '?view=salary&seriesId=42&chapterNumber=1A', '?view=deadlines&seriesId=42', '?view=deadlines&seriesId=&chapterNumber=1A']) assert.equal(readReminderLink(search), null);
});
