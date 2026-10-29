/*
  Warnings:

  - You are about to alter the column `unitCogs` on the `manufacturerinventorycostlayer` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(30,14)`.

*/
-- DropForeignKey
ALTER TABLE `orderassignment` DROP FOREIGN KEY `OrderAssignment_manufacturerId_fkey`;

-- DropIndex
DROP INDEX `CustomerReturn_ncmReturnOrderId_idx` ON `customerreturn`;

-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `distributor` ADD COLUMN `ncmPickupBranch` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `pickupAddress` TEXT NULL,
    ADD COLUMN `pickupBranchStatus` VARCHAR(191) NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN `pickupBranchVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `pickupContactName` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `pickupContactPhone` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `pickupWindow` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `returnInstructions` TEXT NULL;

-- AlterTable
ALTER TABLE `distributordeliverychargenegotiation` ADD COLUMN `bonusRate` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `commissionRate` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `incentiveRate` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13;

-- AlterTable
ALTER TABLE `fiscalyear` ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedBy` VARCHAR(191) NULL,
    ADD COLUMN `isClosed` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `manufacturerinventorycostlayer` MODIFY `unitCogs` DECIMAL(30, 14) NOT NULL;

-- AlterTable
ALTER TABLE `manufacturerproductionrequest` ADD COLUMN `costTermsVersion` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `orderassignment` ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `dispatchedAt` DATETIME(3) NULL,
    ADD COLUMN `onTheWayAt` DATETIME(3) NULL,
    ADD COLUMN `returnedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `product` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `LoyaltyTierConfig` (
    `id` VARCHAR(191) NOT NULL,
    `tierName` VARCHAR(191) NOT NULL,
    `triggerType` VARCHAR(191) NOT NULL DEFAULT 'ORDER_VALUE',
    `minSpendThreshold` DOUBLE NOT NULL DEFAULT 0,
    `giftTargetValue` DOUBLE NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LoyaltyTierConfig_tierName_key`(`tierName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourierOutboxJob` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(32) NOT NULL DEFAULT 'NCM',
    `orderId` VARCHAR(191) NULL,
    `transferId` VARCHAR(191) NULL,
    `jobType` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `lastError` TEXT NULL,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CourierOutboxJob_provider_status_nextAttemptAt_idx`(`provider`, `status`, `nextAttemptAt`),
    INDEX `CourierOutboxJob_orderId_idx`(`orderId`),
    INDEX `CourierOutboxJob_transferId_idx`(`transferId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalPolicyRule` (
    `id` VARCHAR(191) NOT NULL,
    `module` VARCHAR(64) NOT NULL,
    `ruleName` VARCHAR(191) NOT NULL,
    `conditions` JSON NOT NULL,
    `action` VARCHAR(32) NOT NULL DEFAULT 'AUTO_APPROVE',
    `priority` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL DEFAULT 'ADMIN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApprovalPolicyRule_module_isActive_priority_idx`(`module`, `isActive`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShippingRateCache` (
    `id` VARCHAR(191) NOT NULL,
    `originDistrict` VARCHAR(64) NOT NULL,
    `destDistrict` VARCHAR(64) NOT NULL,
    `weightKg` DOUBLE NOT NULL DEFAULT 1.0,
    `rateNPR` DOUBLE NOT NULL,
    `provider` VARCHAR(32) NOT NULL DEFAULT 'NCM',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShippingRateCache_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `ShippingRateCache_provider_originDistrict_destDistrict_weigh_key`(`provider`, `originDistrict`, `destDistrict`, `weightKg`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrderAssignment` ADD CONSTRAINT `OrderAssignment_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
