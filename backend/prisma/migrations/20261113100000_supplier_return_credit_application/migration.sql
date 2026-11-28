CREATE TABLE `SupplierReturnCreditApplication` (
  `id` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `supplierReturnId` VARCHAR(191) NOT NULL,
  `creditDocumentId` VARCHAR(191) NOT NULL,
  `billDocumentId` VARCHAR(191) NOT NULL,
  `journalEntryId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(20, 2) NOT NULL,
  `appliedByAccountId` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SupplierReturnCreditApplication_idempotencyKey_key` (`idempotencyKey`),
  INDEX `SupplierReturnCreditApplication_supplierReturnId_appliedAt_idx` (`supplierReturnId`, `appliedAt`),
  INDEX `SupplierReturnCreditApplication_creditDocumentId_appliedAt_idx` (`creditDocumentId`, `appliedAt`),
  INDEX `SupplierReturnCreditApplication_billDocumentId_appliedAt_idx` (`billDocumentId`, `appliedAt`),
  INDEX `SupplierReturnCreditApplication_journalEntryId_idx` (`journalEntryId`),
  CONSTRAINT `SupplierReturnCreditApplication_supplierReturnId_fkey`
    FOREIGN KEY (`supplierReturnId`) REFERENCES `SupplierReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SupplierReturnCreditApplication_creditDocumentId_fkey`
    FOREIGN KEY (`creditDocumentId`) REFERENCES `AccountingDocument` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SupplierReturnCreditApplication_billDocumentId_fkey`
    FOREIGN KEY (`billDocumentId`) REFERENCES `AccountingDocument` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SupplierReturnCreditApplication_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
