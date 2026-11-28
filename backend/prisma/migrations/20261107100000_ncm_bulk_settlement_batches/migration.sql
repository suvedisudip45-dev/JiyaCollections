CREATE TABLE `NcmSettlementBatch` (
  `id` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `periodStart` DATETIME(3) NULL,
  `periodEnd` DATETIME(3) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'SETTLED',
  `ncmTicketId` INTEGER NULL,
  `totalCod` DECIMAL(20,2) NOT NULL,
  `totalCarrierFee` DECIMAL(20,2) NOT NULL,
  `expectedNetDeposit` DECIMAL(20,2) NOT NULL,
  `actualNetDeposit` DECIMAL(20,2) NOT NULL,
  `varianceAmount` DECIMAL(20,2) NOT NULL DEFAULT 0,
  `varianceType` VARCHAR(40) NULL,
  `varianceReason` TEXT NULL,
  `reference` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `financialAccountId` VARCHAR(191) NOT NULL,
  `journalEntryId` VARCHAR(191) NOT NULL,
  `cashTransactionId` VARCHAR(191) NOT NULL,
  `createdBy` VARCHAR(191) NULL,
  `settledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `NcmSettlementBatch_idempotencyKey_key`(`idempotencyKey`),
  INDEX `NcmSettlementBatch_status_settledAt_idx`(`status`, `settledAt`),
  INDEX `NcmSettlementBatch_ncmTicketId_idx`(`ncmTicketId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `NcmSettlementBatchItem` (
  `id` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `settlementId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `NcmSettlementBatchItem_settlementId_key`(`settlementId`),
  INDEX `NcmSettlementBatchItem_batchId_idx`(`batchId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NcmSettlementBatchItem`
  ADD CONSTRAINT `NcmSettlementBatchItem_batchId_fkey`
  FOREIGN KEY (`batchId`) REFERENCES `NcmSettlementBatch`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NcmSettlementBatchItem`
  ADD CONSTRAINT `NcmSettlementBatchItem_settlementId_fkey`
  FOREIGN KEY (`settlementId`) REFERENCES `DeliveryFinancialSettlement`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `Account` (`id`, `accountCode`, `accountName`, `accountType`, `normalBalance`, `parentAccountId`, `description`, `isSystemAccount`, `isActive`, `currentBalance`, `createdAt`, `updatedAt`)
SELECT UUID(), '2185', 'NCM Remittance Variance Suspense', 'LIABILITY', 'CREDIT', parent.`id`, 'NCM remittance overpayments awaiting reconciliation.', TRUE, TRUE, 0, NOW(3), NOW(3)
FROM `Account` parent
WHERE parent.`accountCode` = '2100'
  AND NOT EXISTS (SELECT 1 FROM `Account` existing WHERE existing.`accountCode` = '2185');
