CREATE TABLE IF NOT EXISTS facility_sheet_entries (
 facility_id VARCHAR(64) PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE
);
