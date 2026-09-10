const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDaylight, calculateShiftDaylightWarnings, parseClockMinutes } = require('../../.tmp/domain-test/src/domain/daylight.js');

function minutes(value) { return parseClockMinutes(value); }

test('Saint Petersburg summer sunrise/sunset are in plausible local ranges without internet', () => {
  const info = calculateDaylight('2027-06-21', undefined, 15);
  assert.ok(minutes(info.sunrise) >= 180 && minutes(info.sunrise) <= 270, `sunrise=${info.sunrise}`);
  assert.ok(minutes(info.sunset) >= 1290 && minutes(info.sunset) <= 1380, `sunset=${info.sunset}`);
  assert.ok(info.daylightMinutes > 1050);
});

test('Saint Petersburg winter daylight is short and local times remain plausible', () => {
  const info = calculateDaylight('2027-12-21', undefined, 15);
  assert.ok(minutes(info.sunrise) >= 570 && minutes(info.sunrise) <= 630, `sunrise=${info.sunrise}`);
  assert.ok(minutes(info.sunset) >= 930 && minutes(info.sunset) <= 990, `sunset=${info.sunset}`);
  assert.ok(info.daylightMinutes < 390);
});

test('white-night period has only a narrow civil-night safe window and preserves next-day offset', () => {
  const info = calculateDaylight('2027-06-21', undefined, 15);
  assert.ok(info.safeNightWindow, 'expected a short civil-night window at Saint Petersburg latitude');
  assert.equal(info.safeNightWindow.startsDayOffset, 1);
  assert.equal(info.safeNightWindow.endsDayOffset, 1);
  const duration = (minutes(info.safeNightWindow.endsAt) + 1440) - (minutes(info.safeNightWindow.startsAt) + 1440);
  assert.ok(duration > 0 && duration < 120, `night window=${duration} minutes`);
});

test('day shift inside safe daylight creates no warning while too-early shift does', () => {
  const base = { startDate: '2027-09-10', endDate: '2027-09-10', daylightBufferMinutes: 15 };
  assert.equal(calculateShiftDaylightWarnings({ ...base, shifts: [{ id: 'ok', name: 'День', kind: 'day', startsAt: '10:00', endsAt: '17:00' }] }).length, 0);
  assert.equal(calculateShiftDaylightWarnings({ ...base, shifts: [{ id: 'bad', name: 'Рано', kind: 'day', startsAt: '04:00', endsAt: '10:00' }] }).length, 1);
});

test('night shift crossing midnight is supported and summer white night warns', () => {
  const winter = calculateShiftDaylightWarnings({
    startDate: '2027-12-21', endDate: '2027-12-21', daylightBufferMinutes: 15,
    shifts: [{ id: 'night', name: 'Ночь', kind: 'night', startsAt: '20:00', endsAt: '05:00' }],
  });
  assert.equal(winter.length, 0);

  const summer = calculateShiftDaylightWarnings({
    startDate: '2027-06-21', endDate: '2027-06-21', daylightBufferMinutes: 15,
    shifts: [{ id: 'night', name: 'Ночь', kind: 'night', startsAt: '23:00', endsAt: '03:00' }],
  });
  assert.equal(summer.length, 1);
});

test('early-morning night shift is evaluated against the night window that began on the previous date', () => {
  const winter = calculateShiftDaylightWarnings({
    startDate: '2027-12-22', endDate: '2027-12-22', daylightBufferMinutes: 15,
    shifts: [{ id: 'early', name: 'Ранняя ночь', kind: 'night', startsAt: '00:30', endsAt: '05:00' }],
  });
  assert.equal(winter.length, 0);
});

test('white-night early-morning shift can fit only the narrow previous-date civil-night window', () => {
  const previous = calculateDaylight('2027-06-21', undefined, 15).safeNightWindow;
  assert.ok(previous);
  const start = previous.startsAt;
  const end = previous.endsAt;
  const summer = calculateShiftDaylightWarnings({
    startDate: '2027-06-22', endDate: '2027-06-22', daylightBufferMinutes: 15,
    shifts: [{ id: 'narrow', name: 'Белая ночь', kind: 'night', startsAt: start, endsAt: end }],
  });
  assert.equal(summer.length, 0);
});
