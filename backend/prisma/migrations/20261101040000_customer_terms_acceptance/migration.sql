CREATE TABLE `CustomerTermsAcceptance` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `termsVersion` CHAR(64) NOT NULL,
    `termsSnapshot` JSON NOT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `source` VARCHAR(32) NOT NULL,

    INDEX `CustomerTermsAcceptance_customerId_acceptedAt_idx`(`customerId`, `acceptedAt`),
    INDEX `CustomerTermsAcceptance_termsVersion_idx`(`termsVersion`),
    PRIMARY KEY (`id`),
    CONSTRAINT `CustomerTermsAcceptance_customerId_fkey`
      FOREIGN KEY (`customerId`) REFERENCES `User`(`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
