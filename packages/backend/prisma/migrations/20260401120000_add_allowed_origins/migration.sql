-- Add allowed_origins to developer_keys for domain locking
ALTER TABLE "developer_keys" ADD COLUMN "allowed_origins" TEXT;
