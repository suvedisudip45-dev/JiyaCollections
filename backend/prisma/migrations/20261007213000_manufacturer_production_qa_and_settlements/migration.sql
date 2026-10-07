ALTER TABLE `ManufacturerProductionRequest`
    MODIFY COLUMN `proposedUnitCogs` DECIMAL(20, 2) NULL,
    ADD COLUMN `fabricType` VARCHAR(120) NULL,
    ADD COLUMN `gsm` DECIMAL(8, 2) NULL,
    ADD COLUMN `targetCompletionDate` DATETIME(3) NULL,
    ADD COLUMN `batchPlan` JSON NULL,
    ADD COLUMN `preProductionChecklist` JSON NULL,
    ADD COLUMN `preProductionCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `postProductionChecklist` JSON NULL,
    ADD COLUMN `postProductionCheckedAt` DATETIME(3) NULL;

ALTER TABLE `ManufacturerProductionRequestLine`
    ADD COLUMN `actualQuantity` INTEGER NULL,
    ADD COLUMN `damagedQuantity` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `ManufacturerSettlementRequest` (
    `id` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NOT NULL,
    `requestType` VARCHAR(191) NOT NULL DEFAULT 'PRODUCTION',
    `amount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `financialAccountId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ManufacturerSettlementRequest_idempotencyKey_key` (`idempotencyKey`),
    INDEX `ManufacturerSettlementRequest_manufacturerId_status_requestedAt_idx` (`manufacturerId`, `status`, `requestedAt`),
    INDEX `ManufacturerSettlementRequest_requestType_status_idx` (`requestType`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ManufacturerSettlementRequest_manufacturerId_fkey`
        FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
