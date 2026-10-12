ALTER TABLE `Order`
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD INDEX `Order_updatedAt_idx` (`updatedAt`);
