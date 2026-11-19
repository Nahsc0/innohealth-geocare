CREATE TABLE IF NOT EXISTS partner_applications (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    organisation VARCHAR(200) NOT NULL,
    created BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    org_id VARCHAR(64) REFERENCES organisations(id),
    role VARCHAR(30),
    activation_hash VARCHAR(64) UNIQUE,
    expires BIGINT
);
