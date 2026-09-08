-- CreateTable
CREATE TABLE "asaas_customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "external_id" TEXT,
    "creation_state" TEXT NOT NULL DEFAULT 'CREATING',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "asaas_webhook_inbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "environment" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_payment_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "gateway_environment" TEXT,
    "gateway_account_ref" TEXT,
    "creation_state" TEXT NOT NULL DEFAULT 'CREATED',
    "active_order_id" TEXT,
    "provider_status" TEXT,
    "refunded_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "review_reason" TEXT,
    "next_reconcile_at" DATETIME,
    "external_reference" TEXT,
    "attempt_key" TEXT,
    "gateway_request_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "payer_name" TEXT,
    "payer_email" TEXT,
    "payer_document" TEXT,
    "details_json" TEXT,
    "webhook_payload_json" TEXT,
    "webhook_verified_at" DATETIME,
    "webhook_source" TEXT,
    "last_error" TEXT,
    "paid_at" DATETIME,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_payment_transactions" ("amount_cents", "attempt_key", "created_at", "details_json", "expires_at", "external_id", "external_reference", "gateway_request_id", "id", "last_error", "order_id", "paid_at", "payer_document", "payer_email", "payer_name", "payment_method", "provider", "status", "updated_at", "webhook_payload_json", "webhook_source", "webhook_verified_at") SELECT "amount_cents", "attempt_key", "created_at", "details_json", "expires_at", "external_id", "external_reference", "gateway_request_id", "id", "last_error", "order_id", "paid_at", "payer_document", "payer_email", "payer_name", "payment_method", "provider", "status", "updated_at", "webhook_payload_json", "webhook_source", "webhook_verified_at" FROM "payment_transactions";
DROP TABLE "payment_transactions";
ALTER TABLE "new_payment_transactions" RENAME TO "payment_transactions";
CREATE UNIQUE INDEX "payment_transactions_active_order_id_key" ON "payment_transactions"("active_order_id");
CREATE INDEX "payment_transactions_order_id_status_idx" ON "payment_transactions"("order_id", "status");
CREATE INDEX "payment_transactions_external_reference_idx" ON "payment_transactions"("external_reference");
CREATE INDEX "payment_transactions_attempt_key_idx" ON "payment_transactions"("attempt_key");
CREATE INDEX "payment_transactions_provider_next_reconcile_at_idx" ON "payment_transactions"("provider", "next_reconcile_at");
CREATE UNIQUE INDEX "payment_transactions_provider_gateway_environment_gateway_account_ref_external_id_key" ON "payment_transactions"("provider", "gateway_environment", "gateway_account_ref", "external_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "asaas_customers_user_id_environment_account_ref_key" ON "asaas_customers"("user_id", "environment", "account_ref");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_customers_environment_account_ref_external_id_key" ON "asaas_customers"("environment", "account_ref", "external_id");

-- CreateIndex
CREATE INDEX "asaas_webhook_inbox_status_next_attempt_at_idx" ON "asaas_webhook_inbox"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_webhook_inbox_environment_account_ref_event_key_key" ON "asaas_webhook_inbox"("environment", "account_ref", "event_key");


-- Preserve the original uniqueness guarantee for unclassified legacy payments.
CREATE UNIQUE INDEX "payment_transactions_legacy_external_id_key"
ON "payment_transactions"("external_id") WHERE "gateway_environment" IS NULL;
