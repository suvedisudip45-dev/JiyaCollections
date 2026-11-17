ALTER TABLE `CashTransaction`
    ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'NPR',
    ADD COLUMN `settlementAmount` DECIMAL(20, 2) NULL,
    ADD COLUMN `tenderMethod` VARCHAR(32) NULL,
    ADD COLUMN `receivedByAccountId` VARCHAR(191) NULL,
    ADD COLUMN `receiptPayloadHash` CHAR(64) NULL;

ALTER TABLE `AccountingAllocation`
    ADD COLUMN `cashTransactionId` VARCHAR(191) NULL,
    ADD INDEX `AccountingAllocation_cashTransactionId_idx` (`cashTransactionId`),
    ADD CONSTRAINT `AccountingAllocation_cashTransactionId_fkey`
        FOREIGN KEY (`cashTransactionId`) REFERENCES `CashTransaction` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
