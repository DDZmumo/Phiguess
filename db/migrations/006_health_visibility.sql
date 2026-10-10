ALTER TABLE matches ADD COLUMN health_enabled boolean NOT NULL DEFAULT true;
UPDATE matches SET health_enabled=false WHERE difficulty='ez';
