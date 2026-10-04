CREATE TABLE `ManufacturerInventoryMovement` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `variantLabel` VARCHAR(191) NOT NULL,
    `previousQty` INTEGER NOT NULL,
    `newQty` INTEGER NOT NULL,
    `changeQty` INTEGER NOT NULL,
    `movementType` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(191) NOT NULL DEFAULT 'MANUFACTURER',
    `source` VARCHAR(191) NOT NULL DEFAULT 'MANUFACTURER_PORTAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ManInvMove_manufacturer_product_created_idx` (`manufacturerId`, `productId`, `createdAt`),
    INDEX `ManInvMove_product_created_idx` (`productId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
