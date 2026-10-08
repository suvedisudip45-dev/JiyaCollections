CREATE TABLE `DistributorGiftInventory` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `giftId` VARCHAR(191) NOT NULL,
  `quantityAvailable` INTEGER NOT NULL DEFAULT 0,
  `quantityReserved` INTEGER NOT NULL DEFAULT 0,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `DistributorGiftInventory_distributorId_status_idx` (`distributorId`, `status`),
  INDEX `DistributorGiftInventory_giftId_status_idx` (`giftId`, `status`),
  CONSTRAINT `DistributorGiftInventory_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `DistributorGiftInventory_giftId_fkey`
    FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Order`
  ADD COLUMN `distributorId` VARCHAR(191) NULL,
  ADD COLUMN `assignedDistributorGiftInventoryId` VARCHAR(191) NULL,
  ADD INDEX `Order_distributorId_idx` (`distributorId`),
  ADD INDEX `Order_assignedDistributorGiftInventoryId_idx` (`assignedDistributorGiftInventoryId`),
  ADD CONSTRAINT `Order_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `Order_assignedDistributorGiftInventoryId_fkey`
    FOREIGN KEY (`assignedDistributorGiftInventoryId`) REFERENCES `DistributorGiftInventory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `DistributorGiftMovementLog` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `giftId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NULL,
  `movementType` VARCHAR(191) NOT NULL DEFAULT 'ALLOCATED',
  `quantity` INTEGER NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `DistributorGiftMovementLog_distributorId_createdAt_idx` (`distributorId`, `createdAt`),
  INDEX `DistributorGiftMovementLog_giftId_createdAt_idx` (`giftId`, `createdAt`),
  CONSTRAINT `DistributorGiftMovementLog_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `DistributorGiftMovementLog_giftId_fkey`
    FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MarketingCardOrder`
  MODIFY `manufacturerId` VARCHAR(191) NULL,
  ADD COLUMN `distributorId` VARCHAR(191) NULL,
  ADD INDEX `MarketingCardOrder_distributorId_attachedAt_idx` (`distributorId`, `attachedAt`),
  ADD CONSTRAINT `MarketingCardOrder_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `MarketingCardAssignment`
  MODIFY `manufacturerId` VARCHAR(191) NULL,
  ADD COLUMN `distributorId` VARCHAR(191) NULL,
  ADD INDEX `MarketingCardAssignment_distributorId_status_idx` (`distributorId`, `status`),
  ADD CONSTRAINT `MarketingCardAssignment_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
