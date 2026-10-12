ALTER TABLE `CustomerReturn`
    ADD COLUMN `distributorId` VARCHAR(191) NULL,
    ADD COLUMN `deliveryRoute` VARCHAR(32) NULL,
    ADD INDEX `CustomerReturn_distributorId_lifecycleStatus_idx`(`distributorId`, `lifecycleStatus`);

ALTER TABLE `OrderExchangeRequest`
    ADD COLUMN `distributorId` VARCHAR(191) NULL,
    ADD COLUMN `deliveryRoute` VARCHAR(32) NULL,
    ADD INDEX `OrderExchangeRequest_distributorId_status_idx`(`distributorId`, `status`);
