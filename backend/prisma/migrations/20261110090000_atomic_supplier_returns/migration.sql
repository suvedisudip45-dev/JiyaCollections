ALTER TABLE `SupplierReturn`
  ADD COLUMN `requestKey` VARCHAR(128) NULL,
  ADD COLUMN `requestHash` CHAR(64) NULL,
  ADD COLUMN `supplierReference` VARCHAR(191) NULL,
  ADD COLUMN `supplierInvoiceNumber` VARCHAR(191) NULL,
  ADD COLUMN `accountingJournalEntryId` VARCHAR(191) NULL,
  ADD COLUMN `accountingDocumentId` VARCHAR(191) NULL,
  ADD COLUMN `cashTransactionId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `SupplierReturn_requestKey_key` (`requestKey`);
