ALTER TABLE `SettlementReversion`
  ADD COLUMN `correctionMode` VARCHAR(24) NULL,
  ADD COLUMN `evidenceReference` VARCHAR(191) NULL,
  ADD COLUMN `reversalJournalEntryId` VARCHAR(191) NULL;

ALTER TABLE `NcmSettlementBatchItem`
  DROP INDEX `NcmSettlementBatchItem_settlementId_key`,
  ADD COLUMN `priorSettlementState` VARCHAR(24) NULL,
  ADD UNIQUE INDEX `NcmSettlementBatchItem_batchId_settlementId_key`(`batchId`, `settlementId`),
  ADD INDEX `NcmSettlementBatchItem_settlementId_idx`(`settlementId`);

ALTER TABLE `NcmSettlementVarianceResolution`
  ADD COLUMN `reversedAt` DATETIME(3) NULL,
  ADD COLUMN `reversedByAccountId` VARCHAR(191) NULL,
  ADD COLUMN `reversalJournalEntryId` VARCHAR(191) NULL,
  ADD COLUMN `reversalCashTransactionId` VARCHAR(191) NULL;
