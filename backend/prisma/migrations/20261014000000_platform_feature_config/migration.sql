CREATE TABLE `PlatformFeatureConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `loyaltyEnabled` BOOLEAN NOT NULL DEFAULT true,
    `marketingCardsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `lettersEnabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `PlatformFeatureConfig` (`id`, `loyaltyEnabled`, `marketingCardsEnabled`, `lettersEnabled`, `updatedAt`)
VALUES ('default', true, true, true, CURRENT_TIMESTAMP(3));
