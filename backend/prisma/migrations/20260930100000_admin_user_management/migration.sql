ALTER TABLE `AuthAccount`
  ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `Role`
  ADD COLUMN `portalScope` VARCHAR(32) NOT NULL DEFAULT 'ADMIN';

UPDATE `Role`
SET `portalScope` = CASE `code`
  WHEN 'ADMIN' THEN 'ADMIN'
  WHEN 'CUSTOMER' THEN 'CUSTOMER'
  WHEN 'MANUFACTURER' THEN 'MANUFACTURER'
  WHEN 'MARKETING_PARTNER' THEN 'MARKETING_PARTNER'
  ELSE `portalScope`
END
WHERE `code` IN ('ADMIN', 'CUSTOMER', 'MANUFACTURER', 'MARKETING_PARTNER');

ALTER TABLE `Admin`
  ADD COLUMN `displayName` VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN `firstName` VARCHAR(80) NULL,
  ADD COLUMN `lastName` VARCHAR(80) NULL;

CREATE TABLE `AccessManagementAuditLog` (
  `id` VARCHAR(191) NOT NULL,
  `actorAccountId` VARCHAR(191) NULL,
  `targetAccountId` VARCHAR(191) NULL,
  `action` VARCHAR(80) NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AccessManagementAuditLog_actorAccountId_createdAt_idx` (`actorAccountId`, `createdAt`),
  INDEX `AccessManagementAuditLog_targetAccountId_createdAt_idx` (`targetAccountId`, `createdAt`),
  INDEX `AccessManagementAuditLog_action_createdAt_idx` (`action`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AccessManagementAuditLog`
  ADD CONSTRAINT `AccessManagementAuditLog_actorAccountId_fkey`
    FOREIGN KEY (`actorAccountId`) REFERENCES `AuthAccount` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `AccessManagementAuditLog_targetAccountId_fkey`
    FOREIGN KEY (`targetAccountId`) REFERENCES `AuthAccount` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;