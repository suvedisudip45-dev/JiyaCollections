CREATE TABLE `CorporateTaxPolicyVersion` (
    `id` VARCHAR(191) NOT NULL,
    `fiscalYear` VARCHAR(32) NOT NULL,
    `baseRate` DECIMAL(5, 2) NOT NULL,
    `brackets` JSON NOT NULL,
    `rules` JSON NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `CorporateTaxPolicyVersion_effectiveFrom_key` (`effectiveFrom`),
    INDEX `CorpTaxPolicy_status_effective_idx` (`status`, `effectiveFrom`, `effectiveUntil`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TaxConfiguration`
    DROP COLUMN `corporateTaxRate`;
