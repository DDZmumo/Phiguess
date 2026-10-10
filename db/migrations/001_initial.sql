CREATE TABLE users (
  id uuid PRIMARY KEY, name varchar(24) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE songs (
  id uuid PRIMARY KEY, title text NOT NULL, aliases jsonb NOT NULL DEFAULT '[]',
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE artworks (
  id uuid PRIMARY KEY, song_id uuid NOT NULL REFERENCES songs(id),
  version text NOT NULL, difficulty text NOT NULL CHECK(difficulty IN ('ez','hd','in','at')),
  storage_key text NOT NULL UNIQUE, mime text NOT NULL,
  bytes integer NOT NULL CHECK(bytes > 0), active boolean NOT NULL DEFAULT true,
  UNIQUE(song_id, version, difficulty)
);
CREATE UNIQUE INDEX artworks_active ON artworks(song_id,difficulty) WHERE active;
CREATE TABLE daily_sets (
  day date PRIMARY KEY, difficulty text NOT NULL,
  artwork_ids jsonb NOT NULL, rules_version text NOT NULL
);
CREATE TABLE matches (
  id uuid PRIMARY KEY, mode text NOT NULL CHECK(mode IN ('practice','daily','room')),
  difficulty text NOT NULL, status text NOT NULL CHECK(status IN ('active','finished','interrupted')),
  daily_day date REFERENCES daily_sets(day), rules_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE match_players (
  match_id uuid NOT NULL REFERENCES matches(id), user_id uuid NOT NULL REFERENCES users(id),
  score integer NOT NULL DEFAULT 0, correct integer NOT NULL DEFAULT 0,
  PRIMARY KEY(match_id,user_id)
);
CREATE TABLE daily_attempts (
  day date NOT NULL REFERENCES daily_sets(day), user_id uuid NOT NULL REFERENCES users(id),
  match_id uuid NOT NULL REFERENCES matches(id), PRIMARY KEY(day,user_id)
);
CREATE TABLE match_rounds (
  match_id uuid NOT NULL REFERENCES matches(id), round integer NOT NULL,
  artwork_id uuid NOT NULL REFERENCES artworks(id), starts_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL, PRIMARY KEY(match_id,round)
);
CREATE TABLE guesses (
  match_id uuid NOT NULL, round integer NOT NULL, user_id uuid NOT NULL,
  request_id uuid NOT NULL, song_id uuid NOT NULL REFERENCES songs(id),
  correct boolean NOT NULL, score integer NOT NULL, elapsed_ms integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,round,user_id), UNIQUE(user_id,request_id),
  FOREIGN KEY(match_id,round) REFERENCES match_rounds(match_id,round),
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id)
);
CREATE INDEX matches_history ON matches(created_at DESC);
