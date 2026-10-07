ALTER TABLE `InventoryDiscrepancy`
    MODIFY COLUMN `stockTransferId` VARCHAR(191) NULL,
    ADD COLUMN `distributorId` VARCHAR(191) NULL,
    ADD COLUMN `inventoryLocationId` VARCHAR(191) NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD INDEX `InventoryDiscrepancy_distributorId_status_createdAt_idx` (`distributorId`, `status`, `createdAt`),
    ADD INDEX `InventoryDiscrepancy_inventoryLocationId_status_idx` (`inventoryLocationId`, `status`),
    ADD UNIQUE INDEX `InventoryDiscrepancy_idempotencyKey_key` (`idempotencyKey`),
    ADD CONSTRAINT `InventoryDiscrepancy_distributorId_fkey`
        FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryDiscrepancy_inventoryLocationId_fkey`
        FOREIGN KEY (`inventoryLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
