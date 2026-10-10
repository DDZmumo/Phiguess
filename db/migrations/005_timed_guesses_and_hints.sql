ALTER TABLE songs ADD COLUMN chapter integer;
ALTER TABLE songs ADD COLUMN composer text;
ALTER TABLE songs ADD COLUMN chapter_name text;
ALTER TABLE artworks ADD COLUMN original_preview_key text;
ALTER TABLE guesses DROP CONSTRAINT guesses_pkey;
ALTER TABLE guesses DROP CONSTRAINT guesses_user_id_request_id_key;
ALTER TABLE guesses ADD PRIMARY KEY(user_id,request_id);
CREATE UNIQUE INDEX guesses_one_correct ON guesses(match_id,round,user_id) WHERE correct;
ALTER TABLE revealed_hints ADD COLUMN kind text NOT NULL DEFAULT 'text';
ALTER TABLE revealed_hints ADD COLUMN difficulty text;
ALTER TABLE revealed_hints ADD COLUMN artwork_id uuid REFERENCES artworks(id);
ALTER TABLE matches ADD COLUMN round_count integer;
ALTER TABLE matches ADD COLUMN round_seconds integer;
-- Historical daily tables and scores are retained; no API creates new daily games.
