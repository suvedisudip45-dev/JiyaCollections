-- AlterTable
ALTER TABLE `color` ADD COLUMN `nepaliName` VARCHAR(191) NULL DEFAULT '';

-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `lettertemplate` ADD COLUMN `targetGender` VARCHAR(191) NOT NULL DEFAULT 'ANY';

-- AlterTable
ALTER TABLE `product` ADD COLUMN `nepaliName` VARCHAR(191) NULL DEFAULT '';

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- AlterTable
ALTER TABLE `user` ADD COLUMN `gender` VARCHAR(191) NULL DEFAULT 'PREFER_NOT_TO_SAY';

-- CreateIndex
CREATE INDEX `LetterTemplate_targetGender_status_idx` ON `LetterTemplate`(`targetGender`, `status`);
