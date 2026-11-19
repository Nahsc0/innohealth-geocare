CREATE TABLE IF NOT EXISTS registration_codes (
 email_hash VARCHAR(64) PRIMARY KEY,
 id VARCHAR(32) UNIQUE NOT NULL,
 verifier VARCHAR(64) NOT NULL,
 created BIGINT NOT NULL,
 expires BIGINT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS registration_codes_expiry ON registration_codes(expires);
CREATE TABLE IF NOT EXISTS individual_profiles (
 user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 demographics TEXT NOT NULL,
 email_verified_at BIGINT NOT NULL
);
