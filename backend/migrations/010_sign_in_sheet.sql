CREATE TABLE IF NOT EXISTS sign_in_sheet_queue (
 event_id VARCHAR(32) PRIMARY KEY,
 account_id VARCHAR(64) NOT NULL,
 account_role VARCHAR(30) NOT NULL,
 signed_in BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_sheet_order ON sign_in_sheet_queue(signed_in,event_id);
