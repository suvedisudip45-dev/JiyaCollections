ALTER TABLE `ShippingConfig`
    ADD COLUMN `sameProvinceFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `differentProvinceFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `splitShipmentFee` DOUBLE NOT NULL DEFAULT 200,
    ADD COLUMN `routeOverrides` JSON NOT NULL DEFAULT ('[]');

UPDATE `ShippingConfig`
SET `sameProvinceFee` = `differentDistrictFee`,
    `differentProvinceFee` = `differentDistrictFee`;

ALTER TABLE `Order`
    ADD COLUMN `checkoutGroupId` VARCHAR(191) NULL,
    ADD INDEX `Order_checkoutGroupId_idx`(`checkoutGroupId`);
