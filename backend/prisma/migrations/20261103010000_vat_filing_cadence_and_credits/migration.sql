ALTER TABLE `TaxFilingRecord`
    ADD COLUMN `filingCadence` VARCHAR(24) NOT NULL DEFAULT 'CUSTOM',
    ADD COLUMN `vatCreditCarryForward` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `carriedForwardPaymentCredit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `assessmentAdjustmentJournalId` VARCHAR(191) NULL,
    ADD COLUMN `assessmentAdjustmentAccountId` VARCHAR(191) NULL,
    ADD COLUMN `paymentCreditApplied` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `sourceReconciliation` JSON NULL;

UPDATE `TaxFilingRecord`
SET `vatCreditCarryForward` = GREATEST(0, -`netVatPayable`)
WHERE `periodType` = 'VAT_RETURN'
  AND `status` IN ('FILED', 'PAID');

UPDATE `TaxFilingRecord` AS filing
SET `carriedForwardPaymentCredit` = GREATEST(
    0,
    COALESCE(
        (SELECT SUM(payment.`amount`)
         FROM `TaxFilingPayment` AS payment
         WHERE payment.`filingRecordId` = filing.`id`),
        filing.`taxPaid`
    ) - GREATEST(COALESCE(filing.`assessedAmount`, 0) - filing.`paymentCreditApplied`, 0)
)
WHERE filing.`periodType` = 'VAT_RETURN'
  AND filing.`status` IN ('FILED', 'PAID');

ALTER TABLE `TaxFilingPayment`
    ADD COLUMN `adjustmentReason` TEXT NULL;

CREATE TABLE `TaxFilingAmendment` (
    `id` VARCHAR(191) NOT NULL,
    `filingRecordId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `previousAssessedAmount` DECIMAL(20, 2) NOT NULL,
    `amendedAssessedAmount` DECIMAL(20, 2) NOT NULL,
    `adjustmentAmount` DECIMAL(20, 2) NOT NULL,
    `amendedDate` DATETIME(3) NOT NULL,
    `amendedReference` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `evidenceUrl` TEXT NULL,
    `adjustmentAccountId` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `paymentCreditJournalEntryId` VARCHAR(191) NULL,
    `recordedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `TaxFilingAmendment_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `TaxFilingAmendment_journalEntryId_key`(`journalEntryId`),
    UNIQUE INDEX `TaxFilingAmendment_paymentCreditJournalEntryId_key`(`paymentCreditJournalEntryId`),
    UNIQUE INDEX `TaxFilingAmendment_filingRecordId_revision_key`(`filingRecordId`, `revision`),
    INDEX `TaxFilingAmendment_filingRecordId_amendedDate_idx`(`filingRecordId`, `amendedDate`),
    PRIMARY KEY (`id`),
    CONSTRAINT `TaxFilingAmendment_filingRecordId_fkey`
      FOREIGN KEY (`filingRecordId`) REFERENCES `TaxFilingRecord`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
