/*
  Warnings:

  - You are about to drop the column `categoryId` on the `journalentry` table. All the data in the column will be lost.

*/
-- DropIndex (idempotent)
SET @exist_idx1 := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customerreturn' AND index_name = 'CustomerReturn_ncmReturnOrderId_idx');
SET @sql1 := IF(@exist_idx1 > 0, 'DROP INDEX `CustomerReturn_ncmReturnOrderId_idx` ON `customerreturn`', 'SELECT 1');
PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- DropIndex (idempotent)
SET @exist_idx2 := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journalentry' AND index_name = 'JournalEntry_categoryId_status_idx');
SET @sql2 := IF(@exist_idx2 > 0, 'DROP INDEX `JournalEntry_categoryId_status_idx` ON `journalentry`', 'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- AlterTable
ALTER TABLE `combobundleproduct` ADD COLUMN `selectedColor` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `journalentry` DROP COLUMN `categoryId`;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `CollaborationProduct` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `listingStatus` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `activeTermsVersion` INTEGER NULL,
    `pendingTermsVersion` INTEGER NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CollaborationProduct_productId_key`(`productId`),
    INDEX `CollaborationProduct_partnerId_listingStatus_idx`(`partnerId`, `listingStatus`),
    INDEX `CollaborationProduct_listingStatus_publishedAt_idx`(`listingStatus`, `publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationTermsVersion` (
    `id` VARCHAR(191) NOT NULL,
    `collaborationProductId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `proposedByRole` VARCHAR(24) NOT NULL,
    `proposedById` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_PARTNER',
    `fixedFeePerUnit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `retailPrice` DECIMAL(20, 2) NOT NULL,
    `discountPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'VAT_EXCLUSIVE',
    `notes` TEXT NULL,
    `respondedByRole` VARCHAR(24) NULL,
    `respondedById` VARCHAR(191) NULL,
    `proposedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollaborationTermsVersion_collaborationProductId_status_idx`(`collaborationProductId`, `status`),
    UNIQUE INDEX `CollaborationTermsVersion_collaborationProductId_version_key`(`collaborationProductId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationSale` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderItemIndex` INTEGER NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `collaborationProductId` VARCHAR(191) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `termsVersion` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `quantityReturned` INTEGER NOT NULL DEFAULT 0,
    `quantityInvoiced` INTEGER NOT NULL DEFAULT 0,
    `quantityCredited` INTEGER NOT NULL DEFAULT 0,
    `size` VARCHAR(64) NOT NULL DEFAULT '',
    `color` VARCHAR(100) NOT NULL DEFAULT '',
    `unitSellingPrice` DECIMAL(20, 2) NOT NULL,
    `unitDiscount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `partnerFeePerUnit` DECIMAL(20, 2) NOT NULL,
    `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'VAT_EXCLUSIVE',
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_DELIVERY',
    `deliveredAt` DATETIME(3) NULL,
    `accruedAt` DATETIME(3) NULL,
    `lastReturnAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CollaborationSale_partnerId_status_deliveredAt_idx`(`partnerId`, `status`, `deliveredAt`),
    INDEX `CollaborationSale_collaborationProductId_status_idx`(`collaborationProductId`, `status`),
    UNIQUE INDEX `CollaborationSale_orderId_orderItemIndex_key`(`orderId`, `orderItemIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationFeeInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(64) NOT NULL,
    `partnerId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `totalUnits` INTEGER NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `accountingDocumentId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CollaborationFeeInvoice_invoiceNumber_key`(`invoiceNumber`),
    UNIQUE INDEX `CollaborationFeeInvoice_accountingDocumentId_key`(`accountingDocumentId`),
    INDEX `CollaborationFeeInvoice_partnerId_issuedAt_idx`(`partnerId`, `issuedAt`),
    UNIQUE INDEX `CollaborationFeeInvoice_partnerId_periodStart_key`(`partnerId`, `periodStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollaborationFeeInvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `entryType` VARCHAR(191) NOT NULL DEFAULT 'FEE',
    `quantity` INTEGER NOT NULL,
    `unitFee` DECIMAL(20, 2) NOT NULL,
    `netAmount` DECIMAL(20, 2) NOT NULL,
    `vatAmount` DECIMAL(20, 2) NOT NULL,
    `totalAmount` DECIMAL(20, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollaborationFeeInvoiceLine_saleId_createdAt_idx`(`saleId`, `createdAt`),
    UNIQUE INDEX `CollaborationFeeInvoiceLine_invoiceId_saleId_entryType_key`(`invoiceId`, `saleId`, `entryType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CollaborationProduct` ADD CONSTRAINT `CollaborationProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationProduct` ADD CONSTRAINT `CollaborationProduct_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationTermsVersion` ADD CONSTRAINT `CollaborationTermsVersion_collaborationProductId_fkey` FOREIGN KEY (`collaborationProductId`) REFERENCES `CollaborationProduct`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_collaborationProductId_fkey` FOREIGN KEY (`collaborationProductId`) REFERENCES `CollaborationProduct`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationSale` ADD CONSTRAINT `CollaborationSale_collaborationProductId_termsVersion_fkey` FOREIGN KEY (`collaborationProductId`, `termsVersion`) REFERENCES `CollaborationTermsVersion`(`collaborationProductId`, `version`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationFeeInvoice` ADD CONSTRAINT `CollaborationFeeInvoice_partnerId_fkey` FOREIGN KEY (`partnerId`) REFERENCES `MarketingPartner`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationFeeInvoiceLine` ADD CONSTRAINT `CollaborationFeeInvoiceLine_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `CollaborationFeeInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollaborationFeeInvoiceLine` ADD CONSTRAINT `CollaborationFeeInvoiceLine_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `CollaborationSale`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
