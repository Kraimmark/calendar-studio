const test = require('node:test');
const assert = require('node:assert/strict');
const { exportSpreadsheet, importSpreadsheet, parseSpreadsheetDate } = require('../../.tmp/domain-test/src/features/calendar/eventSpreadsheet.js');

test('spreadsheet date parser accepts common Excel and human date renderings', () => {
  const variants = [
    '2027-02-03', '2027/2/3', '2027.02.03', '20270203', '03.02.2027', '3/2/2027', '03-02-27',
    '3 февраля 2027', '03 Feb 2027', 'February 3, 2027', '2027-02-03 00:00:00', "'03.02.2027'",
  ];
  for (const value of variants) assert.equal(parseSpreadsheetDate(value, 2, 'Дата начала'), '2027-02-03', value);
  assert.equal(parseSpreadsheetDate('46421', 2, 'Дата начала'), '2027-02-03');
  assert.equal(parseSpreadsheetDate('46421.0', 2, 'Дата начала'), '2027-02-03');
});

test('spreadsheet import accepts comma and tab delimiters and normalises dates', () => {
  const header = 'Название,Дисциплина,Серия,Статус,Дата начала,Дата окончания,Основное';
  const [imported] = importSpreadsheet(`${header}\nМатч,Пистолет,Обычная,Подтверждено,3/2/2027,46426,Да\n`);
  assert.equal(imported.data.startDate, '2027-02-03');
  assert.equal(imported.data.endDate, '2027-02-08');

  const [tabImported] = importSpreadsheet(`Название\tДата начала\tДата окончания\nВторой матч\t2027-08-10\t16 августа 2027\n`);
  assert.equal(tabImported.data.startDate, '2027-08-10');
  assert.equal(tabImported.data.endDate, '2027-08-16');

  const [cpcImported] = importSpreadsheet(`Название;Дисциплина;Дата начала;Дата окончания\nКПК-матч;Карабин пистолетного калибра;2027-08-10;2027-08-11\n`);
  assert.equal(cpcImported.data.discipline, 'cpc');
});

test('spreadsheet export uses a human Excel date format that round-trips without loss', () => {
  const csv = exportSpreadsheet([{ title: 'Матч', organizerName: '', kind: 'match', discipline: 'pistol', series: 'regular', source: 'manual', status: 'draft', competitionStatus: null, competitionRegion: null, competitionPhase: null, competitionStageNumber: null, startDate: '2027-02-03', endDate: '2027-02-08', isPrimary: true, parentEventId: null, venue: '', venueScope: 'unspecified', notes: '', stickerColor: '#808080', registration: { mode: 'free', opensAt: null, closesAt: null, priorityOneAlerts: false }, ekpLevel: null, ekpStageNumber: null, coverPath: null, daylightBufferMinutes: 0, shifts: [], plannedExerciseCount: null, plannedSquadCount: null }]);
  assert.match(csv, /03\.02\.2027;08\.02\.2027/);
  const [imported] = importSpreadsheet(csv);
  assert.equal(imported.data.startDate, '2027-02-03');
  assert.equal(imported.data.endDate, '2027-02-08');
});
