ALTER TABLE users ADD COLUMN login_name text UNIQUE;
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD CONSTRAINT users_account_credentials CHECK ((login_name IS NULL) = (password_hash IS NULL));
