ALTER TABLE artworks ADD COLUMN content_kind text NOT NULL DEFAULT 'main'
  CHECK(content_kind IN ('main','non-main','april-fools'));
ALTER TABLE artworks ADD COLUMN introduced_version text;
ALTER TABLE artworks ADD COLUMN removed boolean NOT NULL DEFAULT false;
ALTER TABLE artworks ADD CONSTRAINT non_main_has_introduction_version
  CHECK(content_kind<>'non-main' OR introduced_version IS NOT NULL);
