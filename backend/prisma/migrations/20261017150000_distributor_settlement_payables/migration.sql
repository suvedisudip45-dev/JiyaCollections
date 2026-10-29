CREATE TABLE `DistributorSettlementRequest` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `grossEarnings` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `incentives` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `discountsApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `chargesApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `netPayable` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `adminNotes` TEXT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `financialAccountId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorSettlementRequest_idempotencyKey_key` (`idempotencyKey`),
    INDEX `DistSettleReq_dist_status_reqAt_idx` (`distributorId`, `status`, `requestedAt`),
    INDEX `DistributorSettlementRequest_status_idx` (`status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DistributorSettlementRequest_distributorId_fkey`
        FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DistributorSettlementRequest`
    ADD COLUMN `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0;
