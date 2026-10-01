ALTER TABLE `Order`
    ADD COLUMN `locationDiscountManufacturerId` VARCHAR(191) NULL,
    ADD COLUMN `locationDiscountProvince` VARCHAR(120) NULL,
    ADD COLUMN `locationDiscountDistrict` VARCHAR(120) NULL,
    ADD COLUMN `locationPricingSnapshot` JSON NULL;

CREATE TABLE `ManufacturerLocation` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ManufacturerLocation_manufacturerId_province_district_key`(`manufacturerId`, `province`, `district`),
    INDEX `ManufacturerLocation_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `ManufacturerLocation_manufacturerId_isActive_idx`(`manufacturerId`, `isActive`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ManufacturerLocation_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LocationProductDiscount` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `discountPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LocationProductDiscount_productId_province_district_key`(`productId`, `province`, `district`),
    INDEX `LocationProductDiscount_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `LocationProductDiscount_productId_isActive_idx`(`productId`, `isActive`),
    PRIMARY KEY (`id`),
    CONSTRAINT `LocationProductDiscount_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;ALTER TABLE `Order`
    ADD COLUMN `locationDiscountManufacturerId` VARCHAR(191) NULL,
    ADD COLUMN `locationDiscountProvince` VARCHAR(120) NULL,
    ADD COLUMN `locationDiscountDistrict` VARCHAR(120) NULL,
    ADD COLUMN `locationPricingSnapshot` JSON NULL;

CREATE TABLE `ManufacturerLocation` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ManufacturerLocation_manufacturerId_province_district_key`(`manufacturerId`, `province`, `district`),
    INDEX `ManufacturerLocation_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `ManufacturerLocation_manufacturerId_isActive_idx`(`manufacturerId`, `isActive`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ManufacturerLocation_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LocationProductDiscount` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `discountPercentage` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `LocationProductDiscount_productId_province_district_key`(`productId`, `province`, `district`),
    INDEX `LocationProductDiscount_province_district_isActive_idx`(`province`, `district`, `isActive`),
    INDEX `LocationProductDiscount_productId_isActive_idx`(`productId`, `isActive`),
    PRIMARY KEY (`id`),
    CONSTRAINT `LocationProductDiscount_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;