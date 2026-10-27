ALTER TABLE `CustomerReturn`
    ADD COLUMN `refundPolicySnapshot` JSON NULL,
    ADD COLUMN `approvedRefundAmount` DECIMAL(20, 2) NULL;

ALTER TABLE `AccountingAllocation`
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `AccountingAllocation_idempotencyKey_key`(`idempotencyKey`);

ALTER TABLE `AccountingDocument`
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `AccountingDocument_idempotencyKey_key`(`idempotencyKey`);

ALTER TABLE `ShippingConfig`
    ADD COLUMN `customerReturnChargeRate` DOUBLE NOT NULL DEFAULT 0;

CREATE TABLE `DeliveryOtpChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `activeOrderKey` VARCHAR(191) NULL,
    `notificationId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `collectionAmount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verifiedAt` DATETIME(3) NULL,
    `createdByAccountId` VARCHAR(191) NULL,
    `requestIp` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `DeliveryOtpChallenge_activeOrderKey_key`(`activeOrderKey`),
    UNIQUE INDEX `DeliveryOtpChallenge_notificationId_key`(`notificationId`),
    UNIQUE INDEX `DeliveryOtpChallenge_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DeliveryOtpChallenge_orderId_status_createdAt_idx`(`orderId`, `status`, `createdAt`),
    INDEX `DeliveryOtpChallenge_distributorId_status_createdAt_idx`(`distributorId`, `status`, `createdAt`),
    INDEX `DeliveryOtpChallenge_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorRemittanceBatch` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `financialAccountId` VARCHAR(191) NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reference` VARCHAR(191) NULL,
    `evidenceUrl` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `recordedByAccountId` VARCHAR(191) NULL,
    `reviewedByAccountId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `DistributorRemittanceBatch_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistributorRemittanceBatch_distributorId_status_receivedAt_idx`(`distributorId`, `status`, `receivedAt`),
    INDEX `DistributorRemittanceBatch_financialAccountId_receivedAt_idx`(`financialAccountId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorCashEvent` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `customerReturnId` VARCHAR(191) NULL,
    `remittanceBatchId` VARCHAR(191) NULL,
    `accountingDocumentId` VARCHAR(191) NULL,
    `eventType` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `paymentMethod` VARCHAR(32) NULL,
    `externalReference` VARCHAR(191) NULL,
    `evidenceUrl` TEXT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedByAccountId` VARCHAR(191) NULL,
    `verifiedByAccountId` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `cashTransactionId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `DistributorCashEvent_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DistributorCashEvent_distributor_event_status_time_idx`(`distributorId`, `eventType`, `status`, `occurredAt`),
    INDEX `DistributorCashEvent_orderId_eventType_status_idx`(`orderId`, `eventType`, `status`),
    INDEX `DistributorCashEvent_customerReturnId_eventType_status_idx`(`customerReturnId`, `eventType`, `status`),
    INDEX `DistributorCashEvent_remittanceBatchId_idx`(`remittanceBatchId`),
    INDEX `DistributorCashEvent_accountingDocumentId_status_idx`(`accountingDocumentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DeliveryOtpChallenge`
    ADD CONSTRAINT `DeliveryOtpChallenge_orderId_fkey`
        FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DeliveryOtpChallenge_distributorId_fkey`
        FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DeliveryOtpChallenge_notificationId_fkey`
        FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `DistributorRemittanceBatch`
    ADD CONSTRAINT `DistributorRemittanceBatch_distributorId_fkey`
        FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DistributorRemittanceBatch_financialAccountId_fkey`
        FOREIGN KEY (`financialAccountId`) REFERENCES `FinancialAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DistributorCashEvent`
    ADD CONSTRAINT `DistributorCashEvent_distributorId_fkey`
        FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DistributorCashEvent_orderId_fkey`
        FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DistributorCashEvent_customerReturnId_fkey`
        FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DistributorCashEvent_remittanceBatchId_fkey`
        FOREIGN KEY (`remittanceBatchId`) REFERENCES `DistributorRemittanceBatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `DistributorCashEvent_accountingDocumentId_fkey`
        FOREIGN KEY (`accountingDocumentId`) REFERENCES `AccountingDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
