CREATE TABLE `DistributorStockReturnCollection` (
  `id` VARCHAR(191) NOT NULL,
  `stockReturnId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'IN_TRANSIT',
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `receiptIdempotencyKey` VARCHAR(191) NULL,
  `receiptRequestHash` CHAR(64) NULL,
  `carrier` VARCHAR(191) NULL,
  `trackingReference` VARCHAR(191) NULL,
  `handoverEvidence` JSON NULL,
  `collectionNotes` TEXT NULL,
  `collectedByAccountId` VARCHAR(191) NOT NULL,
  `collectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `receiptNotes` TEXT NULL,
  `receivedByAccountId` VARCHAR(191) NULL,
  `receivedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `StockReturnCollection_return_status_idx` (`stockReturnId`, `status`, `collectedAt`),
  UNIQUE INDEX `DistributorStockReturnCollection_idempotencyKey_key` (`idempotencyKey`),
  UNIQUE INDEX `DistributorStockReturnCollection_receiptIdempotencyKey_key` (`receiptIdempotencyKey`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturnCollection_stockReturnId_fkey`
    FOREIGN KEY (`stockReturnId`) REFERENCES `DistributorStockReturn` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorStockReturnCollectionLine` (
  `id` VARCHAR(191) NOT NULL,
  `collectionId` VARCHAR(191) NOT NULL,
  `stockReturnLineId` VARCHAR(191) NOT NULL,
  `collectedQuantity` INTEGER NOT NULL,
  `receivedGoodQuantity` INTEGER NOT NULL DEFAULT 0,
  `receivedDamagedQuantity` INTEGER NOT NULL DEFAULT 0,
  `missingQuantity` INTEGER NOT NULL DEFAULT 0,
  `damageType` VARCHAR(120) NULL,
  `evidence` JSON NULL,
  `receiptNotes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `StockReturnCollectionLine_collection_line_key` (`collectionId`, `stockReturnLineId`),
  INDEX `StockReturnCollectionLine_return_line_idx` (`stockReturnLineId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturnCollectionLine_collectionId_fkey`
    FOREIGN KEY (`collectionId`) REFERENCES `DistributorStockReturnCollection` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorStockReturnCollectionLine_stockReturnLineId_fkey`
    FOREIGN KEY (`stockReturnLineId`) REFERENCES `DistributorStockReturnLine` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InventoryDiscrepancy`
  ADD COLUMN `stockReturnCollectionLineId` VARCHAR(191) NULL,
  ADD INDEX `InventoryDiscrepancy_stockReturnCollectionLineId_idx` (`stockReturnCollectionLineId`),
  ADD CONSTRAINT `InventoryDiscrepancy_stockReturnCollectionLineId_fkey`
    FOREIGN KEY (`stockReturnCollectionLineId`) REFERENCES `DistributorStockReturnCollectionLine` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
