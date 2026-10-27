CREATE TABLE `VatRateVersion` (
    `id` VARCHAR(191) NOT NULL,
    `vatRate` DECIMAL(5, 2) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `VatRateVersion_effectiveFrom_key`(`effectiveFrom`),
    INDEX `VatRateVersion_status_effectiveFrom_effectiveUntil_idx`(`status`, `effectiveFrom`, `effectiveUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
