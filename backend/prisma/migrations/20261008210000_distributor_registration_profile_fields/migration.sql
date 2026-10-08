ALTER TABLE `Distributor`
    ADD COLUMN `province` VARCHAR(120) NULL,
    ADD COLUMN `district` VARCHAR(120) NULL,
    ADD COLUMN `street` VARCHAR(191) NULL,
    ADD COLUMN `landmark` VARCHAR(191) NULL,
    ADD COLUMN `contractStartDate` DATETIME(3) NULL,
    ADD COLUMN `contractExpiryDate` DATETIME(3) NULL;
