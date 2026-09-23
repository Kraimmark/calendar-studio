const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, differenceInDays, isLeapYear, parseDateOnly, weekdayMondayIndex } = require('../../.tmp/domain-test/src/domain/dateOnly.js');
const { buildMonth } = require('../../.tmp/domain-test/src/domain/calendar.js');

test('leap rules cover 2028 and non-leap 2100', () => {
  assert.equal(isLeapYear(2028), true);
  assert.equal(parseDateOnly('2028-02-29')?.day, 29);
  assert.equal(isLeapYear(2100), false);
  assert.equal(parseDateOnly('2100-02-29'), null);
});

test('date arithmetic crosses month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(differenceInDays('2026-09-15', '2026-09-01'), 14);
});

test('weekday index is Monday-first', () => {
  assert.equal(weekdayMondayIndex('2026-09-01'), 1);
  assert.equal(weekdayMondayIndex('2028-02-29'), 1);
});

test('buildMonth remains coherent for every supported year/month', () => {
  for (let year = 2026; year <= 2100; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const model = buildMonth(year, month);
      assert.ok(model.weeks >= 4 && model.weeks <= 6);
      assert.equal(model.cells.length, model.weeks * 7);
      assert.equal(model.cells[0].weekday, 0);
      assert.equal(model.cells.at(-1).weekday, 6);
      const current = model.cells.filter((cell) => cell.inCurrentMonth);
      assert.ok(current.length >= 28 && current.length <= 31);
      assert.equal(current[0].day, 1);
    }
  }
});
