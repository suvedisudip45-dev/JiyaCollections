ALTER TABLE `ShippingConfig`
    ADD COLUMN `sameProvinceDoorToDoorFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `sameProvinceDoorToHubFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `differentProvinceDoorToDoorFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `differentProvinceDoorToHubFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `splitShipmentDoorToDoorFee` DOUBLE NOT NULL DEFAULT 200,
    ADD COLUMN `splitShipmentDoorToHubFee` DOUBLE NOT NULL DEFAULT 200;

UPDATE `ShippingConfig`
SET `sameProvinceDoorToDoorFee` = `sameProvinceFee`,
    `sameProvinceDoorToHubFee` = `sameProvinceFee`,
    `differentProvinceDoorToDoorFee` = `differentProvinceFee`,
    `differentProvinceDoorToHubFee` = `differentProvinceFee`,
    `splitShipmentDoorToDoorFee` = `splitShipmentFee`,
    `splitShipmentDoorToHubFee` = `splitShipmentFee`;
