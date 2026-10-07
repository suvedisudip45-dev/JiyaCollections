-- Add assignedDistributorId to MarketingCard for distributor hub card management

-- AlterTable
ALTER TABLE `marketingcard` ADD COLUMN `assignedDistributorId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `MarketingCard_assignedDistributorId_physicalStatus_idx` ON `MarketingCard`(`assignedDistributorId`, `physicalStatus`);

-- AddForeignKey
ALTER TABLE `MarketingCard` ADD CONSTRAINT `MarketingCard_assignedDistributorId_fkey` FOREIGN KEY (`assignedDistributorId`) REFERENCES `Distributor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
