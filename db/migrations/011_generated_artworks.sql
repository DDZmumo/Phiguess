ALTER TABLE artworks ADD COLUMN source_artwork_id uuid REFERENCES artworks(id);
ALTER TABLE artworks ADD COLUMN generation_source_key text;
ALTER TABLE artworks ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE artworks DROP CONSTRAINT artworks_bytes_check;
ALTER TABLE artworks ADD CONSTRAINT artworks_bytes_check CHECK(bytes >= 0);
ALTER TABLE artworks ADD CONSTRAINT artworks_source_present CHECK(storage_key IS NOT NULL OR source_artwork_id IS NOT NULL);
UPDATE artworks a SET source_artwork_id=e.id FROM artworks e
 WHERE a.difficulty IN ('hd','in','at') AND e.difficulty='ez'
 AND a.song_id=e.song_id AND a.version=e.version AND a.variant=e.variant;

CREATE TABLE match_artwork_recipes (
 id uuid PRIMARY KEY,
 match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 round integer NOT NULL CHECK(round >= 0),
 source_artwork_id uuid NOT NULL REFERENCES artworks(id),
 difficulty text NOT NULL CHECK(difficulty IN ('hd','in','at')),
 seed bigint NOT NULL CHECK(seed >= 0 AND seed <= 4294967295),
 algorithm text NOT NULL,
 images jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(match_id,round)
);
