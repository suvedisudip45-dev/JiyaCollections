CREATE TABLE `DistributorServiceEarning` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `serviceType` VARCHAR(24) NOT NULL DEFAULT 'DELIVERY',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `rateCardId` VARCHAR(191) NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `deliveryCharge` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `incentiveAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `commissionAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `otherCharges` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `vatInvoiceVerified` BOOLEAN NOT NULL DEFAULT false,
    `payableAmount` DECIMAL(20, 2) NOT NULL,
    `accountingDocumentId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `DistributorServiceEarning_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `DistributorServiceEarning_accountingDocumentId_key`(`accountingDocumentId`),
    INDEX `DistributorServiceEarning_distributorId_effectiveAt_idx`(`distributorId`, `effectiveAt`),
    INDEX `DistributorServiceEarning_orderId_serviceType_idx`(`orderId`, `serviceType`),
    INDEX `DistributorServiceEarning_assignmentId_serviceType_idx`(`assignmentId`, `serviceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DistributorServiceEarning`
    ADD CONSTRAINT `DistributorServiceEarning_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
