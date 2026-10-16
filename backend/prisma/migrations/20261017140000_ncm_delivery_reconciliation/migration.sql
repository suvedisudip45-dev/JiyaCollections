ALTER TABLE `DeliveryOrder`
    ADD COLUMN `ncmReconciliationRequired` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `ncmReconciliationReason` TEXT NULL,
    ADD INDEX `DeliveryOrder_ncmReconciliationRequired_createdAt_idx` (`ncmReconciliationRequired`, `createdAt`);
