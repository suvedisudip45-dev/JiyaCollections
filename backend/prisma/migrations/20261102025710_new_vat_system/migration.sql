/*
  Warnings:

  - You are about to alter the column `status` on the `taxfilingrecord` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(24)`.

*/
-- AlterTable
ALTER TABLE `CustomerLevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `SpecialOffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- AlterTable
ALTER TABLE `TaxFilingRecord` MODIFY `status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT';

-- RenameIndex
ALTER TABLE `SalesInvoice` RENAME INDEX `salesinvoice_documentNumber_key` TO `SalesInvoice_documentNumber_key`;

-- RenameIndex
ALTER TABLE `SalesInvoice` RENAME INDEX `salesinvoice_documentType_issueDate_idx` TO `SalesInvoice_documentType_issueDate_idx`;

-- RenameIndex
ALTER TABLE `SalesInvoice` RENAME INDEX `salesinvoice_invoiceNumber_key` TO `SalesInvoice_invoiceNumber_key`;

-- RenameIndex
ALTER TABLE `SalesInvoice` RENAME INDEX `salesinvoice_orderId_key` TO `SalesInvoice_orderId_key`;

-- RenameIndex
ALTER TABLE `SalesInvoice` RENAME INDEX `salesinvoice_status_taxPoint_idx` TO `SalesInvoice_status_taxPoint_idx`;

-- RenameIndex
ALTER TABLE `TaxFilingPayment` RENAME INDEX `taxfilingpayment_filingRecordId_paymentDate_idx` TO `TaxFilingPayment_filingRecordId_paymentDate_idx`;

-- RenameIndex
ALTER TABLE `TaxFilingPayment` RENAME INDEX `taxfilingpayment_idempotencyKey_key` TO `TaxFilingPayment_idempotencyKey_key`;

-- RenameIndex
ALTER TABLE `TaxFilingPayment` RENAME INDEX `taxfilingpayment_journalEntryId_key` TO `TaxFilingPayment_journalEntryId_key`;

-- RenameIndex
ALTER TABLE `TaxFilingRecord` RENAME INDEX `taxfilingrecord_periodType_periodKey_idx` TO `TaxFilingRecord_periodType_periodKey_idx`;

-- RenameIndex
ALTER TABLE `TaxFilingRecord` RENAME INDEX `taxfilingrecord_status_filedDate_idx` TO `TaxFilingRecord_status_filedDate_idx`;

-- RenameIndex
ALTER TABLE `TaxRegistrationVersion` RENAME INDEX `taxregistrationversion_effectiveFrom_key` TO `TaxRegistrationVersion_effectiveFrom_key`;

-- RenameIndex
ALTER TABLE `TaxRegistrationVersion` RENAME INDEX `taxregistrationversion_status_effectiveFrom_effectiveUntil_idx` TO `TaxRegistrationVersion_status_effectiveFrom_effectiveUntil_idx`;
