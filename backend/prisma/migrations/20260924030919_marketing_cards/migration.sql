-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `order` ADD COLUMN `marketingCardRequired` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `MarketingPartner` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketingPartner_code_key`(`code`),
    INDEX `MarketingPartner_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `marketingPartnerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `targetScopeType` VARCHAR(191) NOT NULL DEFAULT 'NATIONWIDE',
    `targetProvince` VARCHAR(120) NULL,
    `targetDistrict` VARCHAR(120) NULL,
    `benefitConfig` JSON NOT NULL,
    `requestedQuantity` INTEGER NOT NULL DEFAULT 0,
    `generatedQuantity` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingCampaign_marketingPartnerId_status_idx`(`marketingPartnerId`, `status`),
    INDEX `MarketingCampaign_targetScopeType_targetProvince_targetDistr_idx`(`targetScopeType`, `targetProvince`, `targetDistrict`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardBatch` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `batchCode` VARCHAR(64) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'GENERATED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketingCardBatch_batchCode_key`(`batchCode`),
    INDEX `MarketingCardBatch_campaignId_status_idx`(`campaignId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCard` (
    `id` VARCHAR(191) NOT NULL,
    `cardCode` VARCHAR(64) NOT NULL,
    `qrTokenHash` CHAR(64) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `assignedManufacturerId` VARCHAR(191) NULL,
    `physicalStatus` VARCHAR(191) NOT NULL DEFAULT 'GENERATED',
    `assignedAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `reservedAt` DATETIME(3) NULL,
    `attachedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketingCard_cardCode_key`(`cardCode`),
    UNIQUE INDEX `MarketingCard_qrTokenHash_key`(`qrTokenHash`),
    INDEX `MarketingCard_campaignId_physicalStatus_idx`(`campaignId`, `physicalStatus`),
    INDEX `MarketingCard_assignedManufacturerId_physicalStatus_idx`(`assignedManufacturerId`, `physicalStatus`),
    INDEX `MarketingCard_batchId_physicalStatus_idx`(`batchId`, `physicalStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `assignedBy` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'ASSIGNED',
    `confirmedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,

    INDEX `MarketingCardAssignment_manufacturerId_status_idx`(`manufacturerId`, `status`),
    INDEX `MarketingCardAssignment_cardId_assignedAt_idx`(`cardId`, `assignedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `confirmedBy` VARCHAR(191) NOT NULL,
    `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,

    UNIQUE INDEX `MarketingCardReceipt_assignmentId_key`(`assignmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardOrder` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `attachedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MarketingCardOrder_cardId_key`(`cardId`),
    UNIQUE INDEX `MarketingCardOrder_orderId_key`(`orderId`),
    INDEX `MarketingCardOrder_manufacturerId_attachedAt_idx`(`manufacturerId`, `attachedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardCustomer` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activatedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'LINKED',

    INDEX `MarketingCardCustomer_customerId_status_idx`(`customerId`, `status`),
    UNIQUE INDEX `MarketingCardCustomer_cardId_key`(`cardId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingBenefit` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `benefitType` VARCHAR(191) NOT NULL DEFAULT 'CUSTOM',
    `value` DOUBLE NOT NULL DEFAULT 0,
    `terms` TEXT NULL,
    `startsAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',

    INDEX `MarketingBenefit_campaignId_status_idx`(`campaignId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingCardEvent` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NULL,
    `referenceId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketingCardEvent_cardId_createdAt_idx`(`cardId`, `createdAt`),
    INDEX `MarketingCardEvent_eventType_createdAt_idx`(`eventType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MarketingCampaign` ADD CONSTRAINT `MarketingCampaign_marketingPartnerId_fkey` FOREIGN KEY (`marketingPartnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardBatch` ADD CONSTRAINT `MarketingCardBatch_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `MarketingCardBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_assignedManufacturerId_fkey` FOREIGN KEY (`assignedManufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardAssignment` ADD CONSTRAINT `MarketingCardAssignment_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardAssignment` ADD CONSTRAINT `MarketingCardAssignment_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardReceipt` ADD CONSTRAINT `MarketingCardReceipt_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `MarketingCardAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardOrder` ADD CONSTRAINT `MarketingCardOrder_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardCustomer` ADD CONSTRAINT `MarketingCardCustomer_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardCustomer` ADD CONSTRAINT `MarketingCardCustomer_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefit` ADD CONSTRAINT `MarketingBenefit_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `MarketingCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingCardEvent` ADD CONSTRAINT `MarketingCardEvent_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
