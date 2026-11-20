INSERT INTO organisations (id,name,verified) VALUES ('geocare-individuals','GeoCare individual accounts',1)
ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS account_monthly_activity (
 month VARCHAR(7) NOT NULL,
 user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY (month,user_id)
);
