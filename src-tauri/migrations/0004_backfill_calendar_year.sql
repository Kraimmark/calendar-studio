UPDATE events
SET calendar_year = CAST(substr(start_date, 1, 4) AS INTEGER)
WHERE start_date IS NOT NULL
  AND length(start_date) >= 4
  AND CAST(substr(start_date, 1, 4) AS INTEGER) BETWEEN 2026 AND 2100
  AND calendar_year != CAST(substr(start_date, 1, 4) AS INTEGER);
