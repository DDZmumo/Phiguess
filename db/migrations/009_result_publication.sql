-- Keep results private until their owner explicitly confirms publication.
ALTER TABLE match_players ADD COLUMN result_published boolean NOT NULL DEFAULT false;
