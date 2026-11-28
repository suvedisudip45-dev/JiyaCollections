CREATE TABLE `AccountingActionApproval` (
    `id` VARCHAR(191) NOT NULL,
    `actionType` VARCHAR(48) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `requestKey` VARCHAR(191) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `makerAccountId` VARCHAR(191) NOT NULL,
    `makerRole` VARCHAR(32) NOT NULL,
    `reviewerAccountId` VARCHAR(191) NULL,
    `reviewerRole` VARCHAR(32) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewDecision` VARCHAR(16) NULL,
    `reviewReason` TEXT NULL,
    `resultSnapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AccountingActionApproval_requestKey_key`(`requestKey`),
    INDEX `AccountingActionApproval_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `AccountingActionApproval_actionType_createdAt_idx`(`actionType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountingActionApprovalEvent` (
    `id` VARCHAR(191) NOT NULL,
    `approvalId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `eventType` VARCHAR(32) NOT NULL,
    `actorAccountId` VARCHAR(191) NOT NULL,
    `actorRole` VARCHAR(32) NOT NULL,
    `reason` TEXT NULL,
    `snapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AccountingActionApprovalEvent_approvalId_sequence_key`(`approvalId`, `sequence`),
    INDEX `AccountingActionApprovalEvent_approvalId_createdAt_idx`(`approvalId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AccountingActionApprovalEvent`
ADD CONSTRAINT `AccountingActionApprovalEvent_approvalId_fkey`
FOREIGN KEY (`approvalId`) REFERENCES `AccountingActionApproval`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;
