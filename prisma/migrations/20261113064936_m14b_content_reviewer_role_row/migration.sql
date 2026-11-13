-- M14-b: make the Content reviewer role assignable on existing databases without a re-seed.
-- Additive and idempotent. In its own migration because PostgreSQL can't use an enum value in
-- the transaction that added it.
INSERT INTO "Role" ("id", "key", "name", "description")
VALUES (
  gen_random_uuid()::text,
  'CONTENT_REVIEWER',
  'Content reviewer',
  'Reviews curriculum content and records review decisions. Can''t edit content.'
)
ON CONFLICT ("key") DO NOTHING;
