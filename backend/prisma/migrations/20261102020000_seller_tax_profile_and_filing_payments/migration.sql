CREATE TABLE `SellerTaxProfile` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `legalName` VARCHAR(255) NOT NULL DEFAULT '',
    `panNumber` VARCHAR(32) NOT NULL DEFAULT '',
    `address` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TaxRegistrationVersion` (
    `id` VARCHAR(191) NOT NULL,
    `taxStatus` VARCHAR(24) NOT NULL,
    `vatNumber` VARCHAR(32) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `taxregistrationversion_effectiveFrom_key` (`effectiveFrom`),
    INDEX `taxregistrationversion_status_effectiveFrom_effectiveUntil_idx` (`status`, `effectiveFrom`, `effectiveUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TaxFilingRecord`
    MODIFY `periodType` VARCHAR(32) NOT NULL,
    MODIFY `periodKey` VARCHAR(64) NOT NULL,
    MODIFY `taxableSales` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `outputVat` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `taxablePurchases` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `inputVat` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `carriedForwardInputVat` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `carriedForwardOutputVat` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `netVatPayable` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `taxPaid` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `periodStart` DATETIME(3) NULL,
    ADD COLUMN `periodEnd` DATETIME(3) NULL,
    ADD COLUMN `filedReference` VARCHAR(191) NULL,
    ADD COLUMN `filingEvidenceUrl` TEXT NULL,
    ADD COLUMN `assessedAmount` DECIMAL(20, 2) NULL,
    ADD INDEX `taxfilingrecord_periodType_periodKey_idx` (`periodType`, `periodKey`),
    ADD INDEX `taxfilingrecord_status_filedDate_idx` (`status`, `filedDate`);

CREATE TABLE `TaxFilingPayment` (
    `id` VARCHAR(191) NOT NULL,
    `filingRecordId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `paymentDate` DATETIME(3) NOT NULL,
    `paymentReference` VARCHAR(191) NOT NULL,
    `treasuryAccountId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `evidenceUrl` TEXT NULL,
    `recordedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `taxfilingpayment_idempotencyKey_key` (`idempotencyKey`),
    UNIQUE INDEX `taxfilingpayment_journalEntryId_key` (`journalEntryId`),
    INDEX `taxfilingpayment_filingRecordId_paymentDate_idx` (`filingRecordId`, `paymentDate`),
    PRIMARY KEY (`id`),
    CONSTRAINT `TaxFilingPayment_filingRecordId_fkey` FOREIGN KEY (`filingRecordId`) REFERENCES `TaxFilingRecord` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ManufacturerInventoryCostLayer`
    ADD COLUMN `inputVatRecoverable` BOOLEAN NOT NULL DEFAULT false;

UPDATE `ManufacturerInventoryCostLayer`
SET `inputVatRecoverable` = `vatInvoiceVerified`;

ALTER TABLE `ManufacturerProductionRequest`
    ADD COLUMN `approvedVatInvoiceDate` DATETIME(3) NULL;

CREATE TABLE `SalesInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `documentNumber` VARCHAR(64) NOT NULL,
    `invoiceNumber` VARCHAR(191) NULL,
    `documentType` VARCHAR(32) NOT NULL,
    `issueChannel` VARCHAR(16) NOT NULL DEFAULT 'PAPER',
    `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING_PAPER_DETAILS',
    `taxStatus` VARCHAR(24) NOT NULL,
    `taxTreatment` VARCHAR(32) NOT NULL,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `taxableAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(20, 2) NOT NULL,
    `taxPoint` DATETIME(3) NOT NULL,
    `issueDate` DATETIME(3) NULL,
    `sellerSnapshot` JSON NOT NULL,
    `buyerSnapshot` JSON NOT NULL,
    `lineSnapshots` JSON NOT NULL,
    `evidenceUrl` TEXT NULL,
    `externalProvider` VARCHAR(100) NULL,
    `externalReference` VARCHAR(191) NULL,
    `providerStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_SUBMITTED',
    `createdBy` VARCHAR(191) NULL,
    `issuedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `salesinvoice_orderId_key` (`orderId`),
    UNIQUE INDEX `salesinvoice_documentNumber_key` (`documentNumber`),
    UNIQUE INDEX `salesinvoice_invoiceNumber_key` (`invoiceNumber`),
    INDEX `salesinvoice_status_taxPoint_idx` (`status`, `taxPoint`),
    INDEX `salesinvoice_documentType_issueDate_idx` (`documentType`, `issueDate`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SalesInvoice_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
