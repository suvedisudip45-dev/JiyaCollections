ALTER TABLE `AccountingAllocation`
    ADD COLUMN `reversesAllocationId` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `AccountingAllocation_reversesAllocationId_key` (`reversesAllocationId`),
    ADD CONSTRAINT `AccountingAllocation_reversesAllocationId_fkey`
        FOREIGN KEY (`reversesAllocationId`) REFERENCES `AccountingAllocation` (`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
