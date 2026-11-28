CREATE TABLE `PaperBillBook` (
    `id` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(32) NOT NULL,
    `bookLabel` VARCHAR(120) NOT NULL,
    `seriesPrefix` VARCHAR(60) NOT NULL,
    `startNumber` INTEGER NOT NULL,
    `endNumber` INTEGER NOT NULL,
    `serialWidth` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `PaperBillBook_documentType_status_seriesPrefix_idx` (`documentType`, `status`, `seriesPrefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PaperBillBookAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `bookId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `startNumber` INTEGER NOT NULL,
    `endNumber` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `allocatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `allocatedBy` VARCHAR(191) NULL,
    `returnedAt` DATETIME(3) NULL,
    `returnedBy` VARCHAR(191) NULL,
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `PaperBillBookAllocation_distributorId_status_idx` (`distributorId`, `status`),
    INDEX `PaperBillBookAllocation_bookId_startNumber_endNumber_idx` (`bookId`, `startNumber`, `endNumber`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PaperBillBookAllocation_bookId_fkey` FOREIGN KEY (`bookId`) REFERENCES `PaperBillBook` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `PaperBillBookAllocation_distributorId_fkey` FOREIGN KEY (`distributorId`) REFERENCES `Distributor` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrderAssignment`
    ADD COLUMN `paperBillRequested` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `paperBillStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_SELECTED',
    ADD COLUMN `paperBillDocumentType` VARCHAR(32) NULL,
    ADD COLUMN `paperBillNumber` VARCHAR(191) NULL,
    ADD COLUMN `paperBillAllocationId` VARCHAR(191) NULL,
    ADD COLUMN `paperBillIssuedAt` DATETIME(3) NULL,
    ADD COLUMN `paperBillIssuedBy` VARCHAR(191) NULL,
    ADD COLUMN `paperBillVoidedAt` DATETIME(3) NULL,
    ADD COLUMN `paperBillVoidReason` VARCHAR(500) NULL,
    ADD COLUMN `paperBillAdjustedAt` DATETIME(3) NULL,
    ADD COLUMN `paperBillAdjustmentReason` VARCHAR(500) NULL,
    ADD UNIQUE INDEX `OrderAssignment_paperBillNumber_key` (`paperBillNumber`),
    ADD INDEX `OrderAssignment_paperBillStatus_paperBillIssuedAt_idx` (`paperBillStatus`, `paperBillIssuedAt`),
    ADD CONSTRAINT `OrderAssignment_paperBillAllocationId_fkey` FOREIGN KEY (`paperBillAllocationId`) REFERENCES `PaperBillBookAllocation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `SalesInvoiceAdjustment` (
    `id` VARCHAR(191) NOT NULL,
    `salesInvoiceId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(32) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `adjustmentType` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `internalReference` VARCHAR(128) NULL,
    `externalDocumentNumber` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `SalesInvoiceAdjustment_idempotencyKey_key` (`idempotencyKey`),
    INDEX `SalesInvoiceAdjustment_salesInvoiceId_occurredAt_idx` (`salesInvoiceId`, `occurredAt`),
    INDEX `SalesInvoiceAdjustment_sourceType_sourceId_idx` (`sourceType`, `sourceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SalesInvoiceAdjustment_salesInvoiceId_fkey` FOREIGN KEY (`salesInvoiceId`) REFERENCES `SalesInvoice` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
