ALTER TABLE matches ADD COLUMN match_seconds integer CHECK(match_seconds IN (120,180,300,600,1200));
ALTER TABLE matches ADD COLUMN match_started_at timestamptz;
ALTER TABLE match_players ADD COLUMN dead boolean NOT NULL DEFAULT false;
ALTER TABLE match_players ADD COLUMN survival_ms integer NOT NULL DEFAULT 0 CHECK(survival_ms>=0);
ALTER TABLE match_players ADD COLUMN alive_since timestamptz;
CREATE TABLE match_player_rounds (
  match_id uuid NOT NULL,
  round integer NOT NULL,
  user_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  closed_at timestamptz,
  skipped boolean NOT NULL DEFAULT false,
  PRIMARY KEY(match_id,round,user_id),
  FOREIGN KEY(match_id,round) REFERENCES match_rounds(match_id,round),
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id)
);
INSERT INTO match_player_rounds(match_id,round,user_id,starts_at,deadline,closed_at)
SELECT r.match_id,r.round,p.user_id,r.starts_at,r.deadline,
  CASE WHEN m.status<>'active' THEN LEAST(r.deadline,m.finished_at) END
FROM match_rounds r JOIN matches m ON m.id=r.match_id JOIN match_players p ON p.match_id=m.id WHERE m.mode='room';
UPDATE match_players p SET dead=true FROM matches m
WHERE m.id=p.match_id AND m.mode='room' AND m.health_capacity>0 AND p.health=0;
