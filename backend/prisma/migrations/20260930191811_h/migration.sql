/*
  Warnings:

  - Added the required column `categoryId` to the `JournalEntry` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `journalentry` ADD COLUMN `categoryId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `order` ADD COLUMN `specialOrder` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `specialOrderManufacturerIds` JSON NULL,
    ADD COLUMN `specialOrderReason` TEXT NULL;

-- AlterTable
ALTER TABLE `product` ADD COLUMN `isUnisex` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `ComboBundle` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `color` VARCHAR(191) NULL DEFAULT '',
    `image` TEXT NULL,
    `bannerImage` TEXT NULL,
    `calculatedPrice` DOUBLE NOT NULL DEFAULT 0,
    `sellingPrice` DOUBLE NOT NULL DEFAULT 0,
    `discountPercentage` DOUBLE NOT NULL DEFAULT 0,
    `manualPriceOverride` BOOLEAN NOT NULL DEFAULT false,
    `priceReviewRequired` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComboBundle_slug_key`(`slug`),
    INDEX `ComboBundle_status_idx`(`status`),
    INDEX `ComboBundle_slug_idx`(`slug`),
    INDEX `ComboBundle_categoryId_status_idx`(`categoryId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComboBundleProduct` (
    `id` VARCHAR(191) NOT NULL,
    `comboBundleId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ComboBundleProduct_comboBundleId_idx`(`comboBundleId`),
    INDEX `ComboBundleProduct_productId_idx`(`productId`),
    UNIQUE INDEX `ComboBundleProduct_comboBundleId_productId_key`(`comboBundleId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `JournalEntry_categoryId_status_idx` ON `JournalEntry`(`categoryId`, `status`);

-- AddForeignKey
ALTER TABLE `ComboBundle` ADD CONSTRAINT `ComboBundle_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComboBundleProduct` ADD CONSTRAINT `ComboBundleProduct_comboBundleId_fkey` FOREIGN KEY (`comboBundleId`) REFERENCES `ComboBundle`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComboBundleProduct` ADD CONSTRAINT `ComboBundleProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
