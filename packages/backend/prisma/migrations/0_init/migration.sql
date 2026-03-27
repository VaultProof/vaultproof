-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "global_daily_limit" INTEGER,
    "global_monthly_limit" INTEGER,
    "kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Default',
    "mode" TEXT NOT NULL DEFAULT 'live',
    "allowed_ips" TEXT,
    "allowed_providers" TEXT,
    "allowed_endpoints" TEXT,
    "alert_email" TEXT,
    "alert_threshold" INTEGER,
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "last_used" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "developer_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_tokens" (
    "id" TEXT NOT NULL,
    "developer_key_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_slots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "share1_encrypted" BYTEA NOT NULL,
    "share2_encrypted" BYTEA,
    "vault_commitment" TEXT NOT NULL,
    "auth_apps_root" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "daily_limit" INTEGER,
    "monthly_limit" INTEGER,
    "block_on_limit" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "key_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_grants" (
    "id" TEXT NOT NULL,
    "key_slot_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '{}',
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "app_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL,
    "key_slot_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "zk_proof" TEXT NOT NULL,
    "nullifier" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "developer_keys_key_key" ON "developer_keys"("key");

-- CreateIndex
CREATE UNIQUE INDEX "developer_keys_key_hash_key" ON "developer_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "session_tokens_token_hash_key" ON "session_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "session_tokens_developer_key_id_expires_at_idx" ON "session_tokens"("developer_key_id", "expires_at");

-- CreateIndex
CREATE INDEX "key_slots_user_id_status_idx" ON "key_slots"("user_id", "status");

-- CreateIndex
CREATE INDEX "key_slots_user_id_provider_idx" ON "key_slots"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "access_logs_nullifier_key" ON "access_logs"("nullifier");

-- CreateIndex
CREATE INDEX "access_logs_key_slot_id_action_timestamp_idx" ON "access_logs"("key_slot_id", "action", "timestamp");

-- CreateIndex
CREATE INDEX "access_logs_key_slot_id_timestamp_idx" ON "access_logs"("key_slot_id", "timestamp");

-- CreateIndex
CREATE INDEX "access_logs_app_id_timestamp_idx" ON "access_logs"("app_id", "timestamp");

-- AddForeignKey
ALTER TABLE "developer_keys" ADD CONSTRAINT "developer_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_tokens" ADD CONSTRAINT "session_tokens_developer_key_id_fkey" FOREIGN KEY ("developer_key_id") REFERENCES "developer_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_slots" ADD CONSTRAINT "key_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_grants" ADD CONSTRAINT "app_grants_key_slot_id_fkey" FOREIGN KEY ("key_slot_id") REFERENCES "key_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_key_slot_id_fkey" FOREIGN KEY ("key_slot_id") REFERENCES "key_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

