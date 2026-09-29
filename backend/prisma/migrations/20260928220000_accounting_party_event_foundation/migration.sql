-- Add stable accounting party identities.
CREATE TABLE `AccountingParty` (
    `id` VARCHAR(191) NOT NULL,
    `partyType` VARCHAR(40) NOT NULL,
    `sourceEntityId` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(255) NULL,
    `displayName` VARCHAR(255) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NPR',
    `status` VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AccountingParty_partyType_sourceEntityId_key`(`partyType`, `sourceEntityId`),
    INDEX `AccountingParty_partyType_status_idx`(`partyType`, `status`),
    INDEX `AccountingParty_displayName_idx`(`displayName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add semantic COA account mappings; account codes/IDs are not embedded in domain posters.
CREATE TABLE `AccountingAccountMapping` (
    `id` VARCHAR(191) NOT NULL,
    `mappingKey` VARCHAR(96) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AccountingAccountMapping_mappingKey_key`(`mappingKey`),
    INDEX `AccountingAccountMapping_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add idempotent source-event journal envelopes.
CREATE TABLE `AccountingEvent` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `sourceVersion` INTEGER NOT NULL DEFAULT 1,
    `eventType` VARCHAR(64) NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `payload` JSON NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `attemptCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AccountingEvent_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `AccountingEvent_sourceType_sourceId_sourceVersion_eventType_key`(`sourceType`, `sourceId`, `sourceVersion`, `eventType`),
    INDEX `AccountingEvent_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AccountingEvent_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `AccountingEvent_effectiveAt_idx`(`effectiveAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `JournalEntry`
    ADD COLUMN `accountingEventId` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `JournalEntry_accountingEventId_key`(`accountingEventId`);

ALTER TABLE `JournalLine`
    ADD COLUMN `accountingPartyId` VARCHAR(191) NULL,
    ADD INDEX `JournalLine_accountingPartyId_createdAt_idx`(`accountingPartyId`, `createdAt`);

ALTER TABLE `AccountingAccountMapping`
    ADD CONSTRAINT `AccountingAccountMapping_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `JournalEntry`
    ADD CONSTRAINT `JournalEntry_accountingEventId_fkey`
    FOREIGN KEY (`accountingEventId`) REFERENCES `AccountingEvent`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `JournalLine`
    ADD CONSTRAINT `JournalLine_accountingPartyId_fkey`
    FOREIGN KEY (`accountingPartyId`) REFERENCES `AccountingParty`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;