-- AlterTable
ALTER TABLE "users" ADD COLUMN "postal_code" TEXT;
ALTER TABLE "users" ADD COLUMN "address_number" TEXT;

-- AlterTable
ALTER TABLE "asaas_customers" ADD COLUMN "address_sync_key" TEXT;
