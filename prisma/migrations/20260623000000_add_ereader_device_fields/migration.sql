-- E-reader delivery fields for the ebook sidecar auto-send feature.
-- Both are nullable JSON arrays of strings (default NULL = "not set").
--
-- users.ereader_device_names: Audiobookshelf e-reader device names this user is
--   enrolled in. Organized ebooks the user requested are emailed to each device.
-- requests.ereader_sent_devices: device names already successfully emailed for an
--   (ebook) request. Provides idempotency (no duplicate sends on re-organize/retry)
--   and enables late delivery to users who request the book after it is downloaded.
ALTER TABLE "users" ADD COLUMN "ereader_device_names" JSONB;
ALTER TABLE "requests" ADD COLUMN "ereader_sent_devices" JSONB;
