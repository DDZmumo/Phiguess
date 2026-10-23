ALTER TABLE match_artwork_recipes ADD COLUMN source_key text;
UPDATE match_artwork_recipes r SET source_key=COALESCE(a.generation_source_key,a.storage_key) FROM artworks a WHERE a.id=r.source_artwork_id;
ALTER TABLE match_artwork_recipes ALTER COLUMN source_key SET NOT NULL;
