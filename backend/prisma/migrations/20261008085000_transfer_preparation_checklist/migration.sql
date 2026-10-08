ALTER TABLE `StockTransfer`
    ADD COLUMN `availabilityPassed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `qualityPassed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `colorPassed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sizePassed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `packagingPassed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `preparedByAccountId` VARCHAR(191) NULL,
    ADD COLUMN `preparedAt` DATETIME(3) NULL;
