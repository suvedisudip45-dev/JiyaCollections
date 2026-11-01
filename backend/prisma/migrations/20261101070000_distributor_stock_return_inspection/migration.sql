CREATE TABLE `DistributorStockReturnInspection` (
  `id` VARCHAR(191) NOT NULL,
  `collectionId` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `inspectedByAccountId` VARCHAR(191) NOT NULL,
  `inspectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `DistributorStockReturnInspection_collectionId_key` (`collectionId`),
  UNIQUE INDEX `DistributorStockReturnInspection_idempotencyKey_key` (`idempotencyKey`),
  INDEX `StockReturnInspection_actor_date_idx` (`inspectedByAccountId`, `inspectedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturnInspection_collectionId_fkey`
    FOREIGN KEY (`collectionId`) REFERENCES `DistributorStockReturnCollection` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorStockReturnInspectionLine` (
  `id` VARCHAR(191) NOT NULL,
  `inspectionId` VARCHAR(191) NOT NULL,
  `collectionLineId` VARCHAR(191) NOT NULL,
  `recommendedDisposition` VARCHAR(40) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `conditionNotes` TEXT NOT NULL,
  `evidence` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `StockReturnInspectLine_collection_route_key` (`inspectionId`, `collectionLineId`, `recommendedDisposition`),
  INDEX `StockReturnInspectLine_collection_date_idx` (`collectionLineId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `DistributorStockReturnInspectionLine_inspectionId_fkey`
    FOREIGN KEY (`inspectionId`) REFERENCES `DistributorStockReturnInspection` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DistributorStockReturnInspectionLine_collectionLineId_fkey`
    FOREIGN KEY (`collectionLineId`) REFERENCES `DistributorStockReturnCollectionLine` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
