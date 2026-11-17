CREATE TABLE `CollaborationFeeCreditApplication` (
  `id` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `creditDocumentId` VARCHAR(191) NOT NULL,
  `invoiceDocumentId` VARCHAR(191) NOT NULL,
  `journalEntryId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(20, 2) NOT NULL,
  `appliedByAccountId` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CollaborationFeeCreditApplication_idempotencyKey_key` (`idempotencyKey`),
  INDEX `CollaborationFeeCreditApplication_creditDocumentId_appliedAt_idx` (`creditDocumentId`, `appliedAt`),
  INDEX `CollabFeeCreditApp_invoiceAppliedAt_idx` (`invoiceDocumentId`, `appliedAt`),
  INDEX `CollaborationFeeCreditApplication_journalEntryId_idx` (`journalEntryId`),
  CONSTRAINT `CollaborationFeeCreditApplication_creditDocumentId_fkey`
    FOREIGN KEY (`creditDocumentId`) REFERENCES `AccountingDocument` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CollaborationFeeCreditApplication_invoiceDocumentId_fkey`
    FOREIGN KEY (`invoiceDocumentId`) REFERENCES `AccountingDocument` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CollaborationFeeCreditApplication_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
