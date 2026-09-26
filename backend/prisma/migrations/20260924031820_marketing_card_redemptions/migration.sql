-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- CreateTable
CREATE TABLE `MarketingBenefitRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `cardId` VARCHAR(191) NOT NULL,
    `benefitId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'REDEEMED',
    `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketingBenefitRedemption_customerId_status_idx`(`customerId`, `status`),
    INDEX `MarketingBenefitRedemption_benefitId_redeemedAt_idx`(`benefitId`, `redeemedAt`),
    UNIQUE INDEX `MarketingBenefitRedemption_cardId_benefitId_key`(`cardId`, `benefitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MarketingBenefitRedemption` ADD CONSTRAINT `MarketingBenefitRedemption_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `MarketingCard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefitRedemption` ADD CONSTRAINT `MarketingBenefitRedemption_benefitId_fkey` FOREIGN KEY (`benefitId`) REFERENCES `MarketingBenefit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingBenefitRedemption` ADD CONSTRAINT `MarketingBenefitRedemption_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
