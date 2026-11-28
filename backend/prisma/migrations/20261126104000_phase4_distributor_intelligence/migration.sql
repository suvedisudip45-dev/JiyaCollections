-- Additive Phase 4 reporting and replenishment models.

CREATE TABLE `DistributorInventoryPolicy` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `inventorySkuId` VARCHAR(191) NOT NULL,
  `reorderPoint` INTEGER NOT NULL DEFAULT 0,
  `safetyStock` INTEGER NOT NULL DEFAULT 0,
  `leadTimeDays` INTEGER NOT NULL DEFAULT 7,
  `preferredSource` VARCHAR(32) NOT NULL DEFAULT 'FACTORY',
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdByAccountId` VARCHAR(191) NULL,
  `updatedByAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DistributorInventoryPolicy_distributorId_inventorySkuId_key`(`distributorId`,`inventorySkuId`),
  INDEX `DistributorInventoryPolicy_distributorId_active_idx`(`distributorId`,`active`),
  INDEX `DistributorInventoryPolicy_inventorySkuId_active_idx`(`inventorySkuId`,`active`),
  CONSTRAINT `DistributorInventoryPolicy_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `DistributorInventoryPolicy_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorReplenishmentSuggestion` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `inventorySkuId` VARCHAR(191) NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `salesVelocity14` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `salesVelocity30` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `salesVelocity60` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `salesVelocity90` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `availableQuantity` INTEGER NOT NULL,
  `reservedQuantity` INTEGER NOT NULL,
  `damagedQuantity` INTEGER NOT NULL,
  `incomingQuantity` INTEGER NOT NULL DEFAULT 0,
  `reorderPoint` INTEGER NOT NULL,
  `safetyStock` INTEGER NOT NULL,
  `leadTimeDays` INTEGER NOT NULL,
  `targetQuantity` INTEGER NOT NULL,
  `recommendedQuantity` INTEGER NOT NULL,
  `trend` VARCHAR(24) NOT NULL,
  `confidence` VARCHAR(24) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `demandRequestId` VARCHAR(191) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `snapshot` JSON NOT NULL,
  `createdByAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DistributorReplenishmentSuggestion_idempotencyKey_key`(`idempotencyKey`),
  INDEX `DistributorReplenishmentSuggestion_distributorId_status_createdAt_idx`(`distributorId`,`status`,`createdAt`),
  INDEX `DistributorReplenishmentSuggestion_distributorId_inventorySkuId_periodEnd_idx`(`distributorId`,`inventorySkuId`,`periodEnd`),
  CONSTRAINT `DistributorReplenishmentSuggestion_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `DistributorReplenishmentSuggestion_inventorySkuId_fkey`
    FOREIGN KEY (`inventorySkuId`) REFERENCES `InventorySku`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorProfitSnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `grossSales` DECIMAL(20,2) NOT NULL,
  `grossProfit` DECIMAL(20,2) NOT NULL,
  `operatingExpenses` DECIMAL(20,2) NOT NULL,
  `netEarnings` DECIMAL(20,2) NOT NULL,
  `costDataAvailable` BOOLEAN NOT NULL DEFAULT false,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'NPR',
  `snapshot` JSON NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DistributorProfitSnapshot_idempotencyKey_key`(`idempotencyKey`),
  UNIQUE INDEX `DistributorProfitSnapshot_distributorId_periodStart_periodEnd_key`(`distributorId`,`periodStart`,`periodEnd`),
  INDEX `DistributorProfitSnapshot_distributorId_periodEnd_idx`(`distributorId`,`periodEnd`),
  CONSTRAINT `DistributorProfitSnapshot_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorStatementExport` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  `documentReference` VARCHAR(191) NULL,
  `documentHash` VARCHAR(64) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestedByAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DistributorStatementExport_idempotencyKey_key`(`idempotencyKey`),
  INDEX `DistributorStatementExport_distributorId_periodEnd_idx`(`distributorId`,`periodEnd`),
  INDEX `DistributorStatementExport_distributorId_status_createdAt_idx`(`distributorId`,`status`,`createdAt`),
  CONSTRAINT `DistributorStatementExport_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
