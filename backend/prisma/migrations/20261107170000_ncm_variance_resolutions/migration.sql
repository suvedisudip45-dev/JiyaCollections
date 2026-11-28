CREATE TABLE `NcmSettlementVarianceResolution` (
  `id` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `amount` DECIMAL(20,2) NOT NULL,
  `sourceDocumentId` VARCHAR(191) NULL,
  `targetDocumentId` VARCHAR(191) NULL,
  `financialAccountId` VARCHAR(191) NULL,
  `journalEntryId` VARCHAR(191) NOT NULL,
  `cashTransactionId` VARCHAR(191) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NULL,
  `notes` TEXT NOT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `NcmSettlementVarianceResolution_idempotencyKey_key`(`idempotencyKey`),
  INDEX `NcmSettlementVarianceResolution_batchId_createdAt_idx`(`batchId`, `createdAt`),
  INDEX `NcmSettlementVarianceResolution_sourceDocumentId_idx`(`sourceDocumentId`),
  INDEX `NcmSettlementVarianceResolution_targetDocumentId_idx`(`targetDocumentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD CONSTRAINT `NcmSettlementVarianceResolution_batchId_fkey`
  FOREIGN KEY (`batchId`) REFERENCES `NcmSettlementBatch`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD CONSTRAINT `NcmSettlementVarianceResolution_sourceDocumentId_fkey`
  FOREIGN KEY (`sourceDocumentId`) REFERENCES `AccountingDocument`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD CONSTRAINT `NcmSettlementVarianceResolution_targetDocumentId_fkey`
  FOREIGN KEY (`targetDocumentId`) REFERENCES `AccountingDocument`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD CONSTRAINT `NcmSettlementVarianceResolution_financialAccountId_fkey`
  FOREIGN KEY (`financialAccountId`) REFERENCES `FinancialAccount`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD CONSTRAINT `NcmSettlementVarianceResolution_journalEntryId_fkey`
  FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD CONSTRAINT `NcmSettlementVarianceResolution_cashTransactionId_fkey`
  FOREIGN KEY (`cashTransactionId`) REFERENCES `CashTransaction`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
