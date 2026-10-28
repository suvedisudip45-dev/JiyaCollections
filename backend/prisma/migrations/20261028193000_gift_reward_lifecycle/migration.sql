ALTER TABLE `DistributorGiftInventory`
  ADD COLUMN `quantitySent` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `receivedQuantity` INTEGER NULL;

UPDATE `DistributorGiftInventory`
SET `quantitySent` = `quantityAvailable` + `quantityReserved`;

CREATE TABLE `GiftRewardEntitlement` (
  `id` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(32) NOT NULL,
  `sourceKey` VARCHAR(191) NOT NULL,
  `rewardValue` DOUBLE NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  `checkoutGroupId` VARCHAR(191) NULL,
  `marketingBenefitRedemptionId` VARCHAR(191) NULL,
  `orderId` VARCHAR(191) NULL,
  `giftId` VARCHAR(191) NULL,
  `distributorGiftInventoryId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `assignedAt` DATETIME(3) NULL,
  `fulfilledAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `GiftRewardEntitlement_sourceKey_key` (`sourceKey`),
  UNIQUE INDEX `GiftRewardEntitlement_marketingBenefitRedemptionId_key` (`marketingBenefitRedemptionId`),
  UNIQUE INDEX `GiftRewardEntitlement_orderId_key` (`orderId`),
  INDEX `GiftRewardEntitlement_customerId_status_createdAt_idx` (`customerId`, `status`, `createdAt`),
  INDEX `GiftRewardEntitlement_checkoutGroupId_status_idx` (`checkoutGroupId`, `status`),
  INDEX `GiftRewardEntitlement_giftId_idx` (`giftId`),
  INDEX `GiftRewardEntitlement_distributorGiftInventoryId_idx` (`distributorGiftInventoryId`),
  CONSTRAINT `GiftRewardEntitlement_customerId_fkey`
    FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GiftRewardEntitlement_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `GiftRewardEntitlement_marketingBenefitRedemptionId_fkey`
    FOREIGN KEY (`marketingBenefitRedemptionId`) REFERENCES `MarketingBenefitRedemption`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `GiftRewardEntitlement_giftId_fkey`
    FOREIGN KEY (`giftId`) REFERENCES `GiftCatalog`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `GiftRewardEntitlement_distributorGiftInventoryId_fkey`
    FOREIGN KEY (`distributorGiftInventoryId`) REFERENCES `DistributorGiftInventory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
