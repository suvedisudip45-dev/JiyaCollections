/*
  Warnings:

  - A unique constraint covering the columns `[socialCustomerCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `customerlevel` MODIFY `badgeIcon` VARCHAR(191) NOT NULL DEFAULT '🥉';

-- AlterTable
ALTER TABLE `specialoffer` MODIFY `badgeText` VARCHAR(191) NOT NULL DEFAULT '🎉 FESTIVE OFFER';

-- AlterTable
ALTER TABLE `user` ADD COLUMN `inactiveProfileData` JSON NOT NULL,
    ADD COLUMN `isInactiveProfile` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `loyaltyTier` VARCHAR(191) NULL DEFAULT '',
    ADD COLUMN `socialCustomerCode` VARCHAR(191) NULL,
    ADD COLUMN `socialCustomerPhone` VARCHAR(191) NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX `User_socialCustomerCode_key` ON `User`(`socialCustomerCode`);
