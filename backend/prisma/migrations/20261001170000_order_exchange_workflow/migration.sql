ALTER TABLE `Order`
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancellationReason` TEXT NULL,
    ADD COLUMN `cancelledByUserId` VARCHAR(191) NULL;

ALTER TABLE `MarketingCard`
    ADD COLUMN `exchangeLockRequestId` VARCHAR(191) NULL,
    ADD INDEX `MarketingCard_exchangeLockRequestId_idx`(`exchangeLockRequestId`);

CREATE TABLE `OrderExchangeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(128) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NULL DEFAULT '',
    `manufacturerId` VARCHAR(191) NULL,
    `manufacturerName` VARCHAR(191) NULL,
    `cardId` VARCHAR(191) NULL,
    `reasonCode` VARCHAR(64) NOT NULL,
    `reasonDetails` TEXT NULL,
    `items` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REQUESTED',
    `decisionActorId` VARCHAR(191) NULL,
    `decisionReason` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `ncmReturnOrderId` INTEGER NULL,
    `ncmReplacementOrderId` INTEGER NULL,
    `ncmSubmissionAttemptedAt` DATETIME(3) NULL,
    `ncmSubmissionError` TEXT NULL,
    `returnPickupStatus` VARCHAR(64) NULL,
    `returnPickupCompletedAt` DATETIME(3) NULL,
    `replacementStatus` VARCHAR(64) NULL,
    `replacementDeliveredAt` DATETIME(3) NULL,
    `manufacturerReceivedAt` DATETIME(3) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `inspectionResult` VARCHAR(64) NULL,
    `inspectionNotes` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OrderExchangeRequest_requestKey_key`(`requestKey`),
    UNIQUE INDEX `OrderExchangeRequest_ncmReturnOrderId_key`(`ncmReturnOrderId`),
    UNIQUE INDEX `OrderExchangeRequest_ncmReplacementOrderId_key`(`ncmReplacementOrderId`),
    INDEX `OrderExchangeRequest_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `OrderExchangeRequest_orderId_status_idx`(`orderId`, `status`),
    INDEX `OrderExchangeRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `OrderExchangeRequest_cardId_status_idx`(`cardId`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `OrderExchangeRequest_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `OrderExchangeRequest_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `OrderExchangeRequest_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `OrderExchangeRequest_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OrderExchangeEvent` (
    `id` VARCHAR(191) NOT NULL,
    `exchangeRequestId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `fromStatus` VARCHAR(64) NULL,
    `toStatus` VARCHAR(64) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(32) NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OrderExchangeEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `OrderExchangeEvent_exchangeRequestId_occurredAt_idx`(`exchangeRequestId`, `occurredAt`),
    INDEX `OrderExchangeEvent_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `OrderExchangeEvent_exchangeRequestId_fkey` FOREIGN KEY (`exchangeRequestId`) REFERENCES `OrderExchangeRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;