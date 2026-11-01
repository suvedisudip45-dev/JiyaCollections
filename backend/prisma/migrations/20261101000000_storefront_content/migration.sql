CREATE TABLE `StorefrontContentConfig` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `announcementPrimary` VARCHAR(180) NOT NULL DEFAULT 'Free shipping on orders over Rs 3,000',
    `announcementSecondary` VARCHAR(180) NOT NULL DEFAULT 'Made for everyday movement',
    `benefits` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
