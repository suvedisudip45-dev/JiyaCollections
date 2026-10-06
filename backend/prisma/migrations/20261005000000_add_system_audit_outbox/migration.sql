CREATE TABLE `SystemAuditLog` (
  `id` VARCHAR(191) NOT NULL,
  `outboxId` VARCHAR(36) NULL,
  `actorId` VARCHAR(191) NULL,
  `actorRole` VARCHAR(32) NULL,
  `action` VARCHAR(120) NOT NULL,
  `entityType` VARCHAR(80) NOT NULL,
  `entityId` VARCHAR(191) NULL,
  `beforeState` JSON NULL,
  `afterState` JSON NULL,
  `portalSource` VARCHAR(32) NULL,
  `ipAddress` VARCHAR(64) NULL,
  `userAgent` TEXT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'SUCCESS',
  `failureReason` VARCHAR(255) NULL,
  `correlationId` VARCHAR(128) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SystemAuditLog_outboxId_key` (`outboxId`),
  INDEX `SystemAuditLog_entityType_entityId_idx` (`entityType`, `entityId`),
  INDEX `SystemAuditLog_actorId_idx` (`actorId`),
  INDEX `SystemAuditLog_createdAt_idx` (`createdAt`),
  INDEX `SystemAuditLog_correlationId_idx` (`correlationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SystemAuditOutbox` (
  `id` VARCHAR(36) NOT NULL,
  `event` JSON NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `attemptCount` INTEGER NOT NULL DEFAULT 0,
  `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `claimedAt` DATETIME(3) NULL,
  `processedAt` DATETIME(3) NULL,
  `lastError` VARCHAR(1000) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SystemAuditOutbox_status_availableAt_createdAt_idx` (`status`, `availableAt`, `createdAt`),
  INDEX `SystemAuditOutbox_claimedAt_idx` (`claimedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
