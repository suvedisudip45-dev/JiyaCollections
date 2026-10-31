CREATE TABLE `DistributorBalanceSettlement` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `direction` VARCHAR(24) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'POSTED',
  `receivableApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
  `payableApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
  `cashAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
  `offsetAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
  `reference` VARCHAR(191) NULL,
  `setoffAgreementReference` VARCHAR(191) NULL,
  `setoffConfirmed` BOOLEAN NOT NULL DEFAULT false,
  `setoffConfirmedAt` DATETIME(3) NULL,
  `setoffConfirmedByAccountId` VARCHAR(191) NULL,
  `financialAccountId` VARCHAR(191) NULL,
  `journalEntryId` VARCHAR(191) NULL,
  `cashTransactionId` VARCHAR(191) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdByAccountId` VARCHAR(191) NULL,
  `transferConfirmedAt` DATETIME(3) NULL,
  `transferConfirmedByAccountId` VARCHAR(191) NULL,
  `postedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `DistributorBalanceSettlement_distributorId_postedAt_idx` (`distributorId`, `postedAt`),
  INDEX `DistributorBalanceSettlement_status_postedAt_idx` (`status`, `postedAt`),
  UNIQUE INDEX `DistributorBalanceSettlement_idempotencyKey_key` (`idempotencyKey`),
  UNIQUE INDEX `DistributorBalanceSettlement_journalEntryId_key` (`journalEntryId`),
  UNIQUE INDEX `DistributorBalanceSettlement_cashTransactionId_key` (`cashTransactionId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorBalanceSettlement_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorBalanceSettlement_financialAccountId_fkey`
    FOREIGN KEY (`financialAccountId`) REFERENCES `FinancialAccount` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorBalanceSettlement_journalEntryId_fkey`
    FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorBalanceSettlement_cashTransactionId_fkey`
    FOREIGN KEY (`cashTransactionId`) REFERENCES `CashTransaction` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AccountingAllocation`
  ADD COLUMN `settlementBatchId` VARCHAR(191) NULL,
  ADD COLUMN `allocationType` VARCHAR(16) NULL,
  ADD INDEX `AccountingAllocation_settlementBatchId_allocationType_idx` (`settlementBatchId`, `allocationType`),
  ADD CONSTRAINT `AccountingAllocation_settlementBatchId_fkey`
    FOREIGN KEY (`settlementBatchId`) REFERENCES `DistributorBalanceSettlement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DistributorCashEvent`
  MODIFY `eventType` VARCHAR(40) NOT NULL,
  ADD COLUMN `settlementBatchId` VARCHAR(191) NULL,
  ADD INDEX `DistributorCashEvent_settlementBatchId_idx` (`settlementBatchId`),
  ADD CONSTRAINT `DistributorCashEvent_settlementBatchId_fkey`
    FOREIGN KEY (`settlementBatchId`) REFERENCES `DistributorBalanceSettlement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
