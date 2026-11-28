CREATE TABLE `PortalNotification` (
    `id` VARCHAR(36) NOT NULL,
    `recipientAccountId` VARCHAR(191) NOT NULL,
    `recipientRole` VARCHAR(32) NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `href` VARCHAR(512) NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PortalNotification_recipient_role_created_id_idx` (`recipientAccountId`, `recipientRole`, `createdAt`, `id`),
    INDEX `PortalNotification_recipient_role_read_created_idx` (`recipientAccountId`, `recipientRole`, `isRead`, `createdAt`),
    UNIQUE INDEX `PortalNotification_recipient_role_dedupe_key` (`recipientAccountId`, `recipientRole`, `dedupeKey`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PortalNotification_recipientAccountId_fkey`
      FOREIGN KEY (`recipientAccountId`) REFERENCES `AuthAccount` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
