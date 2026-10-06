-- Additive foundation for platform-owned stock held at manufacturer and distributor locations.
-- No legacy inventory, orders, or payable balances are backfilled or modified here.

INSERT INTO `Role` (`id`, `code`, `name`, `description`, `portalScope`, `isActive`, `createdAt`, `updatedAt`)
SELECT UUID(), 'DISTRIBUTOR', 'Distributor', 'Distributor portal workspace access.', 'DISTRIBUTOR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM `Role` WHERE `code` = 'DISTRIBUTOR');

CREATE TABLE `Distributor` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(40) NULL,
    `address` TEXT NULL,
    `city` VARCHAR(120) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Distributor_accountId_key`(`accountId`),
    INDEX `Distributor_status_isActive_idx`(`status`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventorySku` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `size` VARCHAR(120) NOT NULL,
    `color` VARCHAR(120) NOT NULL,
    `sizeKey` VARCHAR(120) NOT NULL,
    `colorKey` VARCHAR(120) NOT NULL,
    `skuCode` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventorySku_skuCode_key`(`skuCode`),
    UNIQUE INDEX `InventorySku_productId_sizeKey_colorKey_key`(`productId`, `sizeKey`, `colorKey`),
    INDEX `InventorySku_productId_isActive_idx`(`productId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryLocation` (
    `id` VARCHAR(191) NOT NULL,
    `locationKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `inventoryOwner` VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    `manufacturerId` VARCHAR(191) NULL,
    `distributorId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryLocation_locationKey_key`(`locationKey`),
    INDEX `InventoryLocation_kind_isActive_idx`(`kind`, `isActive`),
    INDEX `InventoryLocation_manufacturerId_kind_idx`(`manufacturerId`, `kind`),
    INDEX `InventoryLocation_distributorId_kind_idx`(`distributorId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryBalance` (
    `id` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `quantityOnHand` INTEGER NOT NULL DEFAULT 0,
    `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryBalance_locationId_inventorySkuId_key`(`locationId`, `inventorySkuId`),
    INDEX `InventoryBalance_inventorySkuId_idx`(`inventorySkuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryLedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `sourceLocationId` VARCHAR(191) NULL,
    `destinationLocationId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `movementType` VARCHAR(191) NOT NULL,
    `inventoryOwner` VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    `referenceType` VARCHAR(64) NULL,
    `referenceId` VARCHAR(191) NULL,
    `productionCostLayerId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(64) NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InventoryLedgerEntry_idempotencyKey_key`(`idempotencyKey`),
    INDEX `InventoryLedgerEntry_inventorySkuId_createdAt_idx`(`inventorySkuId`, `createdAt`),
    INDEX `InventoryLedgerEntry_sourceLocationId_createdAt_idx`(`sourceLocationId`, `createdAt`),
    INDEX `InventoryLedgerEntry_destinationLocationId_createdAt_idx`(`destinationLocationId`, `createdAt`),
    INDEX `InventoryLedgerEntry_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `sourceLocationId` VARCHAR(191) NOT NULL,
    `destinationLocationId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL',
    `requestedByAccountId` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedByAccountId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `adminNote` TEXT NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockTransfer_manufacturerId_status_requestedAt_idx`(`manufacturerId`, `status`, `requestedAt`),
    INDEX `StockTransfer_distributorId_status_requestedAt_idx`(`distributorId`, `status`, `requestedAt`),
    INDEX `StockTransfer_status_requestedAt_idx`(`status`, `requestedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockTransferLine` (
    `id` VARCHAR(191) NOT NULL,
    `stockTransferId` VARCHAR(191) NOT NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `requestedQuantity` INTEGER NOT NULL,
    `approvedQuantity` INTEGER NULL,
    `dispatchedQuantity` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockTransferLine_stockTransferId_inventorySkuId_key`(`stockTransferId`, `inventorySkuId`),
    INDEX `StockTransferLine_inventorySkuId_idx`(`inventorySkuId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockTransferShipment` (
    `id` VARCHAR(191) NOT NULL,
    `stockTransferId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PREPARING',
    `deliveryPartner` VARCHAR(191) NULL,
    `trackingNumber` VARCHAR(191) NULL,
    `externalReference` VARCHAR(191) NULL,
    `bookedAt` DATETIME(3) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockTransferShipment_stockTransferId_status_idx`(`stockTransferId`, `status`),
    INDEX `StockTransferShipment_trackingNumber_idx`(`trackingNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockTransferShipmentLine` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `stockTransferLineId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockTransferShipmentLine_shipmentId_stockTransferLineId_key`(`shipmentId`, `stockTransferLineId`),
    INDEX `StockTransferShipmentLine_stockTransferLineId_idx`(`stockTransferLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockTransferReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CONFIRMED',
    `receivedBy` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockTransferReceipt_shipmentId_receivedAt_idx`(`shipmentId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StockTransferReceiptLine` (
    `id` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NOT NULL,
    `shipmentLineId` VARCHAR(191) NOT NULL,
    `goodQuantity` INTEGER NOT NULL DEFAULT 0,
    `damagedQuantity` INTEGER NOT NULL DEFAULT 0,
    `missingQuantity` INTEGER NOT NULL DEFAULT 0,
    `damageType` VARCHAR(120) NULL,
    `evidence` JSON NULL,
    `note` TEXT NULL,

    UNIQUE INDEX `StockTransferReceiptLine_receiptId_shipmentLineId_key`(`receiptId`, `shipmentLineId`),
    INDEX `StockTransferReceiptLine_shipmentLineId_idx`(`shipmentLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InventoryDiscrepancy` (
    `id` VARCHAR(191) NOT NULL,
    `stockTransferId` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NULL,
    `receiptId` VARCHAR(191) NULL,
    `inventorySkuId` VARCHAR(191) NOT NULL,
    `discrepancyType` VARCHAR(191) NOT NULL,
    `custodyStage` VARCHAR(64) NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `reportedBy` VARCHAR(191) NULL,
    `reportedByRole` VARCHAR(64) NULL,
    `evidence` JSON NULL,
    `details` TEXT NULL,
    `financialResponsibleParty` VARCHAR(32) NOT NULL DEFAULT 'PLATFORM',
    `responsiblePartyRole` VARCHAR(64) NULL,
    `responsiblePartyId` VARCHAR(191) NULL,
    `platformLossAmount` DECIMAL(20, 2) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `InventoryDiscrepancy_stockTransferId_status_createdAt_idx`(`stockTransferId`, `status`, `createdAt`),
    INDEX `InventoryDiscrepancy_shipmentId_status_idx`(`shipmentId`, `status`),
    INDEX `InventoryDiscrepancy_receiptId_idx`(`receiptId`),
    INDEX `InventoryDiscrepancy_inventorySkuId_discrepancyType_idx`(`inventorySkuId`, `discrepancyType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ManufacturerInventoryCostLayer`
    ADD COLUMN `inventorySkuId` VARCHAR(191) NULL;

ALTER TABLE `Distributor`
    ADD CONSTRAINT `Distributor_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `InventorySku`
    ADD CONSTRAINT `InventorySku_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryLocation`
    ADD CONSTRAINT `InventoryLocation_manufacturerId_fkey`
    FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryLocation_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryBalance`
    ADD CONSTRAINT `InventoryBalance_locationId_fkey`
    FOREIGN KEY (`locationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryBalance_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryLedgerEntry`
    ADD CONSTRAINT `InventoryLedgerEntry_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryLedgerEntry_sourceLocationId_fkey`
    FOREIGN KEY (`sourceLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryLedgerEntry_destinationLocationId_fkey`
    FOREIGN KEY (`destinationLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryLedgerEntry_productionCostLayerId_fkey`
    FOREIGN KEY (`productionCostLayerId`) REFERENCES `ManufacturerInventoryCostLayer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransfer`
    ADD CONSTRAINT `StockTransfer_manufacturerId_fkey`
    FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransfer_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransfer_sourceLocationId_fkey`
    FOREIGN KEY (`sourceLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransfer_destinationLocationId_fkey`
    FOREIGN KEY (`destinationLocationId`) REFERENCES `InventoryLocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransferLine`
    ADD CONSTRAINT `StockTransferLine_stockTransferId_fkey`
    FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransferLine_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransferShipment`
    ADD CONSTRAINT `StockTransferShipment_stockTransferId_fkey`
    FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransferShipmentLine`
    ADD CONSTRAINT `StockTransferShipmentLine_shipmentId_fkey`
    FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransferShipmentLine_stockTransferLineId_fkey`
    FOREIGN KEY (`stockTransferLineId`) REFERENCES `StockTransferLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransferReceipt`
    ADD CONSTRAINT `StockTransferReceipt_shipmentId_fkey`
    FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransferReceiptLine`
    ADD CONSTRAINT `StockTransferReceiptLine_receiptId_fkey`
    FOREIGN KEY (`receiptId`) REFERENCES `StockTransferReceipt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransferReceiptLine_shipmentLineId_fkey`
    FOREIGN KEY (`shipmentLineId`) REFERENCES `StockTransferShipmentLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `InventoryDiscrepancy`
    ADD CONSTRAINT `InventoryDiscrepancy_stockTransferId_fkey`
    FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryDiscrepancy_shipmentId_fkey`
    FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryDiscrepancy_receiptId_fkey`
    FOREIGN KEY (`receiptId`) REFERENCES `StockTransferReceipt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `InventoryDiscrepancy_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ManufacturerInventoryCostLayer`
    ADD CONSTRAINT `ManufacturerInventoryCostLayer_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
