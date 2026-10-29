ALTER TABLE `FinancialAccount`
    MODIFY `currentBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `reservedBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT `FinancialAccount_reserved_lte_balance_chk`
    CHECK (`reservedBalance` <= `currentBalance`);

ALTER TABLE `CashTransaction`
    MODIFY `amount` DECIMAL(20, 2) NOT NULL;

ALTER TABLE `AccountPayable`
    MODIFY `totalAmount` DECIMAL(20, 2) NOT NULL,
    MODIFY `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `remainingBalance` DECIMAL(20, 2) NOT NULL;

ALTER TABLE `AccountReceivable`
    MODIFY `totalAmount` DECIMAL(20, 2) NOT NULL,
    MODIFY `receivedAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `remainingBalance` DECIMAL(20, 2) NOT NULL;

ALTER TABLE `ManufacturerSettlementRequest`
    ADD COLUMN `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0;

CREATE TABLE `FinancialPayout` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(32) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `financialAccountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `settlementAmount` DECIMAL(20, 2) NOT NULL,
    `adjustmentType` VARCHAR(16) NOT NULL DEFAULT 'NONE',
    `adjustmentAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(24) NOT NULL DEFAULT 'INITIATED',
    `externalPaymentReference` VARCHAR(191) NULL,
    `bankEvidenceReference` VARCHAR(191) NULL,
    `initiatedByAccountId` VARCHAR(191) NULL,
    `confirmedByAccountId` VARCHAR(191) NULL,
    `failedByAccountId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `failureReason` TEXT NULL,
    `initiatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FinancialPayout_targetType_targetId_status_idx`(`targetType`, `targetId`, `status`),
    INDEX `FinancialPayout_financialAccountId_status_idx`(`financialAccountId`, `status`),
    UNIQUE INDEX `FinancialPayout_idempotencyKey_key`(`idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FinancialPayout`
    ADD CONSTRAINT `FinancialPayout_financialAccountId_fkey`
    FOREIGN KEY (`financialAccountId`) REFERENCES `FinancialAccount`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
