ALTER TABLE `DeliveryOrder`
  MODIFY `manufacturerId` VARCHAR(191) NULL,
  ADD COLUMN `distributorId` VARCHAR(191) NULL,
  ADD INDEX `DeliveryOrder_distributorId_state_idx` (`distributorId`, `state`);

ALTER TABLE `DeliveryReturn`
  MODIFY `manufacturerId` VARCHAR(191) NULL,
  ADD COLUMN `distributorId` VARCHAR(191) NULL,
  ADD INDEX `DeliveryReturn_distributorId_state_idx` (`distributorId`, `state`);

UPDATE `DeliveryOrder` SET `nextSyncAt` = NULL;
