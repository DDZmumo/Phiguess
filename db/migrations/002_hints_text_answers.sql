ALTER TABLE songs ADD COLUMN hints jsonb NOT NULL DEFAULT '[]';
ALTER TABLE guesses ALTER COLUMN song_id DROP NOT NULL;
ALTER TABLE guesses ADD COLUMN answer_text text;
CREATE TABLE revealed_hints (
  match_id uuid NOT NULL, round integer NOT NULL, user_id uuid NOT NULL,
  hint_index integer NOT NULL CHECK(hint_index BETWEEN 0 AND 2),
  content text NOT NULL, revealed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,round,user_id,hint_index),
  FOREIGN KEY(match_id,round) REFERENCES match_rounds(match_id,round),
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id)
);
