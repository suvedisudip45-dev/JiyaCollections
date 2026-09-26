-- CreateTable
CREATE TABLE `AuthSession` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `tokenFamilyId` VARCHAR(64) NOT NULL,
    `jti` VARCHAR(128) NOT NULL,
    `tokenType` VARCHAR(191) NOT NULL DEFAULT 'ACCESS',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedByTokenId` VARCHAR(128) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdIp` VARCHAR(64) NULL,
    `lastUsedIp` VARCHAR(64) NULL,
    `userAgent` TEXT NULL,
    `revocationReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AuthSession_jti_key`(`jti`),
    INDEX `AuthSession_accountId_tokenType_revokedAt_idx`(`accountId`, `tokenType`, `revokedAt`),
    INDEX `AuthSession_tokenFamilyId_idx`(`tokenFamilyId`),
    INDEX `AuthSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `AuthAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
