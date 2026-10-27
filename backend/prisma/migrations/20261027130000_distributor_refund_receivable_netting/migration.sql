CREATE TABLE `DistributorSettlementOffset` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `approvedByAccountId` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DistributorSettlementOffset_journalEntryId_key`(`journalEntryId`),
    UNIQUE INDEX `DistributorSettlementOffset_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistributorSettlementOffset_distributorId_approvedAt_idx`(`distributorId`, `approvedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DistributorSettlementOffset`
    ADD CONSTRAINT `DistributorSettlementOffset_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DistributorSettlementOffset`
    ADD CONSTRAINT `DistributorSettlementOffset_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
