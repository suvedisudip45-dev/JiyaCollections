/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `MarketingPartner` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `marketingbenefit` ADD COLUMN `assignedQuantity` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `percentage` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `quantity` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `marketingcampaign` ADD COLUMN `adDescription` TEXT NULL,
    ADD COLUMN `adExternalLink` VARCHAR(255) NULL,
    ADD COLUMN `adHeadline` VARCHAR(255) NULL,
    ADD COLUMN `adMediaType` VARCHAR(191) NULL DEFAULT 'NONE',
    ADD COLUMN `adMediaUrl` TEXT NULL,
    ADD COLUMN `cardExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `cpaRate` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `minOrderValue` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `targetCategories` JSON NOT NULL;

-- AlterTable
ALTER TABLE `marketingcard` ADD COLUMN `benefitId` VARCHAR(191) NULL,
    ADD COLUMN `hasBenefit` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `marketingcardcustomer` ADD COLUMN `inStoreOtp` VARCHAR(6) NULL,
    ADD COLUMN `lastRedeemedLocation` VARCHAR(255) NULL,
    ADD COLUMN `otpExpiresAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `marketingpartner` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `contactPhone` VARCHAR(32) NULL,
    ADD COLUMN `email` VARCHAR(255) NULL,
    ADD COLUMN `passwordHash` VARCHAR(255) NULL,
    ADD COLUMN `website` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `product` ADD COLUMN `colorImages` JSON NOT NULL;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `MarketingPartnerSettlement` (
    `id` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `totalRedemptions` INTEGER NOT NULL DEFAULT 0,
    `cpaRate` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'UNPAID',
    `paidAt` DATETIME(3) NULL,
    `referenceNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingPartnerSettlement_partnerId_paymentStatus_idx`(`partnerId`, `paymentStatus`),
    INDEX `MarketingPartnerSettlement_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LocationMapping` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(4) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `province` VARCHAR(120) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LocationMapping_code_key`(`code`),
    INDEX `LocationMapping_type_idx`(`type`),
    INDEX `LocationMapping_name_idx`(`name`),
    INDEX `LocationMapping_province_idx`(`province`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `MarketingCard_benefitId_idx` ON `MarketingCard`(`benefitId`);

-- CreateIndex
CREATE UNIQUE INDEX `MarketingPartner_email_key` ON `MarketingPartner`(`email`);

-- CreateIndex
CREATE INDEX `MarketingPartner_email_idx` ON `MarketingPartner`(`email`);

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_benefitId_fkey` FOREIGN KEY (`benefitId`) REFERENCES `MarketingBenefit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPartnerSettlement` ADD CONSTRAINT `MarketingPartnerSettlement_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPartnerSettlement` ADD CONSTRAINT `MarketingPartnerSettlement_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
