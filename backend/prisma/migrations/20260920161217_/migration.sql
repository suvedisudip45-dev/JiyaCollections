/*
  Warnings:

  - You are about to drop the column `baseCity` on the `shippingconfig` table. All the data in the column will be lost.
  - You are about to drop the column `differentCityFee` on the `shippingconfig` table. All the data in the column will be lost.
  - You are about to drop the column `sameCityFee` on the `shippingconfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `manufacturer` ADD COLUMN `adminCommissionFeedback` TEXT NULL,
    ADD COLUMN `agreedCommissionRate` DOUBLE NULL,
    ADD COLUMN `commissionNote` TEXT NULL,
    ADD COLUMN `commissionStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `ncmPickupBranch` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `pickupAddress` TEXT NULL,
    ADD COLUMN `pickupBranchStatus` VARCHAR(191) NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN `pickupBranchVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `pickupContactName` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `pickupContactPhone` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `pickupWindow` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `proposedCommissionRate` DOUBLE NULL,
    ADD COLUMN `returnInstructions` TEXT NULL;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `deliveryFee` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `shippingconfig` DROP COLUMN `baseCity`,
    DROP COLUMN `differentCityFee`,
    DROP COLUMN `sameCityFee`,
    ADD COLUMN `differentDistrictFee` DOUBLE NOT NULL DEFAULT 120,
    ADD COLUMN `sameDistrictFee` DOUBLE NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `NcmBranch` (
    `id` VARCHAR(191) NOT NULL,
    `ncmPk` INTEGER NOT NULL,
    `code` VARCHAR(40) NULL,
    `name` VARCHAR(120) NOT NULL,
    `branchType` VARCHAR(80) NULL,
    `geocode` VARCHAR(120) NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(40) NULL,
    `phone2` VARCHAR(80) NULL,
    `provinceName` VARCHAR(120) NULL,
    `districtName` VARCHAR(120) NULL,
    `coveredAreas` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastSyncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NcmBranch_ncmPk_key`(`ncmPk`),
    UNIQUE INDEX `NcmBranch_name_key`(`name`),
    INDEX `NcmBranch_isActive_districtName_idx`(`isActive`, `districtName`),
    INDEX `NcmBranch_isActive_provinceName_idx`(`isActive`, `provinceName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
