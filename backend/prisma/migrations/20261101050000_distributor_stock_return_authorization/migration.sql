CREATE TABLE `DistributorStockReturn` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
  `reason` TEXT NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `holdLocationId` VARCHAR(191) NULL,
  `createdByAccountId` VARCHAR(191) NOT NULL,
  `reviewedByAccountId` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewNotes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `DistributorStockReturn_distributorId_status_createdAt_idx` (`distributorId`, `status`, `createdAt`),
  INDEX `DistributorStockReturn_status_createdAt_idx` (`status`, `createdAt`),
  UNIQUE INDEX `DistributorStockReturn_idempotencyKey_key` (`idempotencyKey`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturn_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorStockReturn_holdLocationId_fkey`
    FOREIGN KEY (`holdLocationId`) REFERENCES `InventoryLocation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorStockReturnLine` (
  `id` VARCHAR(191) NOT NULL,
  `stockReturnId` VARCHAR(191) NOT NULL,
  `inventorySkuId` VARCHAR(191) NOT NULL,
  `productNameSnapshot` VARCHAR(191) NOT NULL,
  `sizeSnapshot` VARCHAR(120) NOT NULL,
  `colorSnapshot` VARCHAR(120) NOT NULL,
  `requestedQuantity` INTEGER NOT NULL,
  `approvedQuantity` INTEGER NULL,
  `heldQuantity` INTEGER NOT NULL DEFAULT 0,
  `costedQuantity` INTEGER NOT NULL DEFAULT 0,
  `uncostedQuantity` INTEGER NOT NULL DEFAULT 0,
  `layerCogsAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `DistributorStockReturnLine_stockReturnId_inventorySkuId_key` (`stockReturnId`, `inventorySkuId`),
  INDEX `DistributorStockReturnLine_inventorySkuId_createdAt_idx` (`inventorySkuId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturnLine_stockReturnId_fkey`
    FOREIGN KEY (`stockReturnId`) REFERENCES `DistributorStockReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorStockReturnLine_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorStockReturnEvent` (
  `id` VARCHAR(191) NOT NULL,
  `stockReturnId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `fromStatus` VARCHAR(32) NULL,
  `toStatus` VARCHAR(32) NOT NULL,
  `actorAccountId` VARCHAR(191) NOT NULL,
  `notes` TEXT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `DistributorStockReturnEvent_stockReturnId_createdAt_idx` (`stockReturnId`, `createdAt`),
  INDEX `DistributorStockReturnEvent_actorAccountId_createdAt_idx` (`actorAccountId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturnEvent_stockReturnId_fkey`
    FOREIGN KEY (`stockReturnId`) REFERENCES `DistributorStockReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
