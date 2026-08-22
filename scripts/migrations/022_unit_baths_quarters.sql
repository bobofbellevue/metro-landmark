-- Bath counts use quarter-steps (1.25, 1.75), not tenths.
-- DECIMAL(3,1) rounded 1.75 to 1.8.
ALTER TABLE units
  ALTER COLUMN baths TYPE DECIMAL(4,2);
