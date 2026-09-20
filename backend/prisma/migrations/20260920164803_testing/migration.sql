-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `manufacturer` ADD COLUMN `commissionFinalizedAt` DATETIME(3) NULL,
    ADD COLUMN `commissionHistory` JSON NULL,
    ADD COLUMN `commissionLastProposedBy` VARCHAR(191) NULL DEFAULT 'ADMIN',
    ADD COLUMN `commissionLockUntil` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';
