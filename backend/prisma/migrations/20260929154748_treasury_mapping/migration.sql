/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `CashTransaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `cashtransaction` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `operatingexpense` ADD COLUMN `financialAccountId` VARCHAR(191) NULL,
    ADD COLUMN `payableId` VARCHAR(191) NULL,
    ADD COLUMN `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'PAID';

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `DirectIncome` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `toAccountId` VARCHAR(191) NOT NULL,
    `payerName` VARCHAR(191) NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DirectIncome_category_idx`(`category`),
    INDEX `DirectIncome_date_idx`(`date`),
    INDEX `DirectIncome_toAccountId_idx`(`toAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinancialCategory` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(191) NULL DEFAULT '#6366f1',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FinancialCategory_code_key`(`code`),
    INDEX `FinancialCategory_type_isActive_idx`(`type`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementReversion` (
    `id` VARCHAR(191) NOT NULL,
    `reversionType` VARCHAR(48) NOT NULL,
    `originalRecordId` VARCHAR(191) NOT NULL,
    `cashTransactionId` VARCHAR(191) NULL,
    `reversalTransactionId` VARCHAR(191) NULL,
    `originalAmount` DOUBLE NOT NULL,
    `offsetAmount` DOUBLE NOT NULL DEFAULT 0,
    `partyName` VARCHAR(255) NULL,
    `accountId` VARCHAR(191) NULL,
    `accountName` VARCHAR(255) NULL,
    `priorStatus` VARCHAR(32) NOT NULL,
    `restoredStatus` VARCHAR(32) NOT NULL,
    `priorPaidAmount` DOUBLE NOT NULL DEFAULT 0,
    `priorRemainingBalance` DOUBLE NOT NULL DEFAULT 0,
    `revertedByAdminId` VARCHAR(191) NULL,
    `revertedByEmail` VARCHAR(255) NULL,
    `revertReason` TEXT NOT NULL,
    `revertedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SettlementReversion_reversionType_originalRecordId_idx`(`reversionType`, `originalRecordId`),
    INDEX `SettlementReversion_revertedAt_idx`(`revertedAt`),
    INDEX `SettlementReversion_revertedByAdminId_idx`(`revertedByAdminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `CashTransaction_idempotencyKey_key` ON `CashTransaction`(`idempotencyKey`);

-- CreateIndex
CREATE INDEX `CashTransaction_referenceId_idx` ON `CashTransaction`(`referenceId`);

-- CreateIndex
CREATE INDEX `OperatingExpense_paymentStatus_idx` ON `OperatingExpense`(`paymentStatus`);

-- CreateIndex
CREATE INDEX `OperatingExpense_financialAccountId_idx` ON `OperatingExpense`(`financialAccountId`);

-- CreateIndex
CREATE INDEX `OperatingExpense_payableId_idx` ON `OperatingExpense`(`payableId`);

-- RenameIndex
ALTER TABLE `notificationoutbox` RENAME INDEX `NotificationOutbox_delivery_idx` TO `NotificationOutbox_publishedAt_nextAttemptAt_leaseExpiresAt_idx`;
