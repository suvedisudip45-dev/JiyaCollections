ALTER TABLE `ManufacturerInventoryCostLayer`
    ADD COLUMN `manufacturerPayableRecognizedAtProduction` BOOLEAN NOT NULL DEFAULT false;

UPDATE `ManufacturerInventoryCostLayer` AS layer
INNER JOIN `JournalEntry` AS entry
    ON entry.`idempotencyKey` = CONCAT('MANUFACTURER_PRODUCTION:', layer.`productionRequestId`)
SET layer.`manufacturerPayableRecognizedAtProduction` = true;
