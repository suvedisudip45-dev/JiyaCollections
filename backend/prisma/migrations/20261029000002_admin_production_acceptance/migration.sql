ALTER TABLE `ManufacturerProductionRequest`
    ADD COLUMN `productionReviewDecision` VARCHAR(16) NULL,
    ADD COLUMN `productionReviewedBy` VARCHAR(191) NULL,
    ADD COLUMN `productionReviewedAt` DATETIME(3) NULL,
    ADD COLUMN `productionReviewNote` TEXT NULL;
