-- Who was in the team when a team output line was logged, so later team changes never rewrite history.
ALTER TABLE "output_entries" ADD COLUMN "team_member_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
