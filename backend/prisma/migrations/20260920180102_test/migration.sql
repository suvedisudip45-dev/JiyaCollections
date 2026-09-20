-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `Story` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `assignmentEnabled` BOOLEAN NOT NULL DEFAULT true,
    `allowNewCustomers` BOOLEAN NOT NULL DEFAULT true,
    `allowAfterCompletion` BOOLEAN NOT NULL DEFAULT true,
    `assignmentWeight` DOUBLE NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Story_status_assignmentEnabled_idx`(`status`, `assignmentEnabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoryLetter` (
    `id` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `sequenceNumber` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `continuitySummary` TEXT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoryLetter_storyId_sequenceNumber_idx`(`storyId`, `sequenceNumber`),
    UNIQUE INDEX `StoryLetter_storyId_sequenceNumber_key`(`storyId`, `sequenceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LetterTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `selectionWeight` DOUBLE NOT NULL DEFAULT 1,
    `repetitionWindow` INTEGER NULL DEFAULT 3,
    `body` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LetterTemplate_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LetterTemplateVersion` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `body` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LetterTemplateVersion_templateId_idx`(`templateId`),
    UNIQUE INDEX `LetterTemplateVersion_templateId_versionNumber_key`(`templateId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerStoryAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `nextSequenceNumber` INTEGER NOT NULL DEFAULT 1,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerStoryAssignment_customerId_status_idx`(`customerId`, `status`),
    INDEX `CustomerStoryAssignment_storyId_status_idx`(`storyId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LetterDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `customerStoryAssignmentId` VARCHAR(191) NOT NULL,
    `storyId` VARCHAR(191) NOT NULL,
    `storyLetterId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateVersionId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RESERVED',
    `reservedAt` DATETIME(3) NULL,
    `printedAt` DATETIME(3) NULL,
    `packedAt` DATETIME(3) NULL,
    `shippedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `renderedContent` TEXT NULL,
    `renderedHtml` TEXT NULL,
    `renderedDocumentUrl` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LetterDelivery_orderId_key`(`orderId`),
    UNIQUE INDEX `LetterDelivery_idempotencyKey_key`(`idempotencyKey`),
    INDEX `LetterDelivery_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `LetterDelivery_storyId_createdAt_idx`(`storyId`, `createdAt`),
    INDEX `LetterDelivery_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StoryLetter` ADD CONSTRAINT `StoryLetter_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `Story`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterTemplateVersion` ADD CONSTRAINT `LetterTemplateVersion_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `LetterTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryAssignment` ADD CONSTRAINT `CustomerStoryAssignment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerStoryAssignment` ADD CONSTRAINT `CustomerStoryAssignment_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `Story`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_customerStoryAssignmentId_fkey` FOREIGN KEY (`customerStoryAssignmentId`) REFERENCES `CustomerStoryAssignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_storyId_fkey` FOREIGN KEY (`storyId`) REFERENCES `Story`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_storyLetterId_fkey` FOREIGN KEY (`storyLetterId`) REFERENCES `StoryLetter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `LetterTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LetterDelivery` ADD CONSTRAINT `LetterDelivery_templateVersionId_fkey` FOREIGN KEY (`templateVersionId`) REFERENCES `LetterTemplateVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
