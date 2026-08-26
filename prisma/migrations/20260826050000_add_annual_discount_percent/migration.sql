-- Reconciles migration history with a column that was already applied to the
-- database out-of-band (via `prisma db push` or similar) before this migration
-- file existed. Resolved as already-applied, not executed.
ALTER TABLE `AppSettings` ADD COLUMN `annualDiscountPercent` INT NOT NULL DEFAULT 20;
