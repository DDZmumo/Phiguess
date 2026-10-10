ALTER TABLE matches ADD COLUMN health_capacity integer NOT NULL DEFAULT 0 CHECK (health_capacity IN (0,20,50));
UPDATE matches SET health_capacity=20 WHERE health_enabled AND difficulty<>'ez';
ALTER TABLE match_players ADD COLUMN health integer NOT NULL DEFAULT 0 CHECK (health BETWEEN 0 AND 50);
UPDATE match_players p SET health=m.health_capacity FROM matches m WHERE m.id=p.match_id;
CREATE TABLE noise_hits (
  match_id uuid NOT NULL,
  round integer NOT NULL,
  user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  health_after integer NOT NULL CHECK (health_after BETWEEN 0 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id),
  FOREIGN KEY(match_id,round) REFERENCES match_rounds(match_id,round),
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id)
);
