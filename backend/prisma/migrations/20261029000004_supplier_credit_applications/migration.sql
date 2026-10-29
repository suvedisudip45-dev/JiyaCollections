CREATE TABLE `SupplierCreditApplication` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `creditDocumentId` VARCHAR(191) NOT NULL,
    `billDocumentId` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `appliedByAccountId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupplierCreditApplication_creditDocumentId_appliedAt_idx`(`creditDocumentId`, `appliedAt`),
    INDEX `SupplierCreditApplication_billDocumentId_appliedAt_idx`(`billDocumentId`, `appliedAt`),
    INDEX `SupplierCreditApplication_journalEntryId_idx`(`journalEntryId`),
    UNIQUE INDEX `SupplierCreditApplication_idempotencyKey_key`(`idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SupplierCreditApplication`
    ADD CONSTRAINT `SupplierCreditApplication_creditDocumentId_fkey`
    FOREIGN KEY (`creditDocumentId`) REFERENCES `AccountingDocument`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SupplierCreditApplication_billDocumentId_fkey`
    FOREIGN KEY (`billDocumentId`) REFERENCES `AccountingDocument`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SupplierCreditApplication_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
