ALTER TABLE `OperatingExpense`
    ADD COLUMN `supplierVatNumber` VARCHAR(9) NULL,
    ADD COLUMN `invoiceEvidenceUrl` TEXT NULL,
    ADD COLUMN `purchaseTaxableAmount` DECIMAL(20, 2) NULL,
    ADD COLUMN `purchaseVatRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `purchaseVatStatus` VARCHAR(24) NOT NULL DEFAULT 'NOT_CLAIMED',
    ADD COLUMN `purchaseVatVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `purchaseVatVerifiedBy` VARCHAR(191) NULL,
    ADD COLUMN `purchaseVatReviewReason` TEXT NULL,
    ADD COLUMN `purchaseVatJournalEntryId` VARCHAR(191) NULL;

ALTER TABLE `ManufacturerProductionRequest`
    ADD COLUMN `approvedVatInvoiceEvidenceUrl` TEXT NULL;

CREATE UNIQUE INDEX `OperatingExpense_purchaseVatJournalEntryId_key`
    ON `OperatingExpense`(`purchaseVatJournalEntryId`);
CREATE UNIQUE INDEX `OperatingExpense_supplierVatNumber_invoiceNumber_key`
    ON `OperatingExpense`(`supplierVatNumber`, `invoiceNumber`);
CREATE INDEX `OperatingExpense_purchaseVatStatus_date_idx`
    ON `OperatingExpense`(`purchaseVatStatus`, `date`);
