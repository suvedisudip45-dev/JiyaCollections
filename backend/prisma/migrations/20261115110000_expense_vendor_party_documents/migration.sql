ALTER TABLE `AccountPayable`
    ADD COLUMN `accountingPartyId` VARCHAR(191) NULL,
    ADD INDEX `AccountPayable_accountingPartyId_idx` (`accountingPartyId`),
    ADD CONSTRAINT `AccountPayable_accountingPartyId_fkey`
        FOREIGN KEY (`accountingPartyId`) REFERENCES `AccountingParty`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `OperatingExpense`
    ADD COLUMN `accountingPartyId` VARCHAR(191) NULL,
    ADD INDEX `OperatingExpense_accountingPartyId_idx` (`accountingPartyId`),
    ADD CONSTRAINT `OperatingExpense_accountingPartyId_fkey`
        FOREIGN KEY (`accountingPartyId`) REFERENCES `AccountingParty`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
