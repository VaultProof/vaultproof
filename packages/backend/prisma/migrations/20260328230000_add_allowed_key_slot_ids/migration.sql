-- Add allowed_key_slot_ids to developer_keys
-- null = access all key slots; comma-separated IDs = restrict to those slots only
ALTER TABLE "developer_keys" ADD COLUMN "allowed_key_slot_ids" TEXT;
