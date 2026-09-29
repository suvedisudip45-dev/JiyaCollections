-- CreateTable
CREATE TABLE `AccountingDocument` (
    `id` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(32) NOT NULL,
    `documentNumber` VARCHAR(64) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(16) NOT NULL,
    `sourceType` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `issueDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NPR',
    `originalAmount` DECIMAL(20, 2) NOT NULL,
    `allocatedAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0.00,
    `remainingAmount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountingDocument_documentNumber_key`(`documentNumber`),
    INDEX `AccountingDocument_partyId_side_status_idx`(`partyId`, `side`, `status`),
    INDEX `AccountingDocument_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `AccountingDocument_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountingAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `allocatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,

    INDEX `AccountingAllocation_documentId_allocatedAt_idx`(`documentId`, `allocatedAt`),
    INDEX `AccountingAllocation_journalEntryId_idx`(`journalEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountingDocument` ADD CONSTRAINT `AccountingDocument_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `AccountingParty`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountingAllocation` ADD CONSTRAINT `AccountingAllocation_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `AccountingDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
