ALTER TABLE `OrderExchangeRequest`
    ADD COLUMN `replacementPaperBillNumber` VARCHAR(191) NULL,
    ADD COLUMN `replacementPaperBillAllocationId` VARCHAR(191) NULL,
    ADD COLUMN `replacementPaperBillIssuedAt` DATETIME(3) NULL,
    ADD COLUMN `replacementPaperBillIssuedBy` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `OrderExchangeRequest_replacementPaperBillNumber_key` (`replacementPaperBillNumber`),
    ADD CONSTRAINT `OrderExchangeRequest_replacementPaperBillAllocationId_fkey`
        FOREIGN KEY (`replacementPaperBillAllocationId`) REFERENCES `PaperBillBookAllocation` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
