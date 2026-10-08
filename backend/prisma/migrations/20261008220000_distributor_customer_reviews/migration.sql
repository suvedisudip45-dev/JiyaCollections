ALTER TABLE `Distributor`
    ADD COLUMN `qualityRating` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `ratingCount` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `DistributorReview` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorReview_orderId_key`(`orderId`),
    INDEX `DistributorReview_distributorId_createdAt_idx`(`distributorId`, `createdAt`),
    INDEX `DistributorReview_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DistributorReview_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `DistributorReview_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `DistributorReview_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
