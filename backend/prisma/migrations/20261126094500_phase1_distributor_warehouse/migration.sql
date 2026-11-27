-- Additive Phase 1 warehouse models. No existing columns or data are changed.

CREATE TABLE `DistributorPrePack` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdByAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DistributorPrePack_distributorId_name_key`(`distributorId`, `name`),
  INDEX `DistributorPrePack_distributorId_isActive_idx`(`distributorId`, `isActive`),
  CONSTRAINT `DistributorPrePack_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorPrePackLine` (
  `id` VARCHAR(191) NOT NULL,
  `prePackId` VARCHAR(191) NOT NULL,
  `inventorySkuId` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DistributorPrePackLine_prePackId_inventorySkuId_key`(`prePackId`, `inventorySkuId`),
  INDEX `DistributorPrePackLine_inventorySkuId_idx`(`inventorySkuId`),
  CONSTRAINT `DistributorPrePackLine_prePackId_fkey`
    FOREIGN KEY (`prePackId`) REFERENCES `DistributorPrePack`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `DistributorPrePackLine_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarehouseScanEvent` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `inventorySkuId` VARCHAR(191) NULL,
  `scanCode` VARCHAR(191) NOT NULL,
  `operation` VARCHAR(32) NOT NULL,
  `referenceType` VARCHAR(64) NULL,
  `referenceId` VARCHAR(191) NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `matched` BOOLEAN NOT NULL DEFAULT false,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `actorAccountId` VARCHAR(191) NULL,
  `details` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WarehouseScanEvent_idempotencyKey_key`(`idempotencyKey`),
  INDEX `WarehouseScanEvent_distributorId_operation_createdAt_idx`(`distributorId`, `operation`, `createdAt`),
  INDEX `WarehouseScanEvent_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
  INDEX `WarehouseScanEvent_scanCode_idx`(`scanCode`),
  CONSTRAINT `WarehouseScanEvent_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WarehouseScanEvent_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarehouseCycleCount` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `countCode` VARCHAR(64) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
  `notes` TEXT NULL,
  `createdByAccountId` VARCHAR(191) NULL,
  `completedByAccountId` VARCHAR(191) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WarehouseCycleCount_countCode_key`(`countCode`),
  INDEX `WarehouseCycleCount_distributorId_status_createdAt_idx`(`distributorId`, `status`, `createdAt`),
  CONSTRAINT `WarehouseCycleCount_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WarehouseCycleCountLine` (
  `id` VARCHAR(191) NOT NULL,
  `cycleCountId` VARCHAR(191) NOT NULL,
  `inventorySkuId` VARCHAR(191) NOT NULL,
  `systemQuantity` INTEGER NOT NULL,
  `countedQuantity` INTEGER NOT NULL,
  `varianceQuantity` INTEGER NOT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `WarehouseCycleCountLine_cycleCountId_inventorySkuId_key`(`cycleCountId`, `inventorySkuId`),
  INDEX `WarehouseCycleCountLine_inventorySkuId_idx`(`inventorySkuId`),
  CONSTRAINT `WarehouseCycleCountLine_cycleCountId_fkey`
    FOREIGN KEY (`cycleCountId`) REFERENCES `WarehouseCycleCount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WarehouseCycleCountLine_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
