CREATE TABLE `DistributorBonusPlan` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `periodType` VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
    `metric` VARCHAR(32) NOT NULL DEFAULT 'DELIVERED_ORDERS',
    `tiers` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DistributorBonusPlan_distributorId_status_effectiveFrom_idx` (`distributorId`, `status`, `effectiveFrom`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DistributorBonusPlan_distributorId_fkey`
      FOREIGN KEY (`distributorId`) REFERENCES `Distributor` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorBonusEarning` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `eligibleDeliveryCount` INTEGER NOT NULL,
    `bonusAmount` DECIMAL(20, 2) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `accountingDocumentId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DistributorBonusEarning_idempotencyKey_key` (`idempotencyKey`),
    UNIQUE INDEX `DistributorBonusEarning_distributorId_periodStart_key` (`distributorId`, `periodStart`),
    UNIQUE INDEX `DistributorBonusEarning_accountingDocumentId_key` (`accountingDocumentId`),
    INDEX `DistributorBonusEarning_distributorId_periodEnd_idx` (`distributorId`, `periodEnd`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DistributorBonusEarning_distributorId_fkey`
      FOREIGN KEY (`distributorId`) REFERENCES `Distributor` (`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `DistributorBonusEarning_planId_fkey`
      FOREIGN KEY (`planId`) REFERENCES `DistributorBonusPlan` (`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DistributorSettlementRequest`
    ADD COLUMN `bonuses` DECIMAL(20, 2) NOT NULL DEFAULT 0;
