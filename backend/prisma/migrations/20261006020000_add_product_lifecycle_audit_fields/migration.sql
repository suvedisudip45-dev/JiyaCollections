-- Add lifecycle audit fields to Product table
-- This migration is additive and non-breaking: existing rows receive
-- server-side defaults and no existing columns or FKs are modified.

-- createdAt: defaults to NOW() for new rows; existing rows get current timestamp
ALTER TABLE `Product` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- updatedAt: defaults to NOW() and auto-updates on row modification
ALTER TABLE `Product` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- deletedAt: nullable timestamp for soft-delete; null = active record
ALTER TABLE `Product` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- Index on deletedAt for efficient soft-delete filtering
CREATE INDEX `Product_deletedAt_idx` ON `Product`(`deletedAt`);
