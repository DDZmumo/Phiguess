ALTER TABLE artworks ADD COLUMN variant text NOT NULL DEFAULT 'default';
ALTER TABLE artworks ADD COLUMN original_key text;
ALTER TABLE artworks DROP CONSTRAINT artworks_song_id_version_difficulty_key;
ALTER TABLE artworks ADD CONSTRAINT artworks_song_version_difficulty_variant UNIQUE(song_id,version,difficulty,variant);
DROP INDEX artworks_active;
CREATE UNIQUE INDEX artworks_active ON artworks(song_id,difficulty,variant) WHERE active;
