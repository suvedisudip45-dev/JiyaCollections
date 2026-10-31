ALTER TABLE `LocationProductDiscount`
  DROP INDEX `LocationProductDiscount_productId_province_district_key`,
  ADD COLUMN `distributorId` VARCHAR(191) NULL,
  ADD COLUMN `scopeKey` VARCHAR(191) NOT NULL DEFAULT 'ALL',
  ADD INDEX `LocationProductDiscount_distributorId_isActive_idx` (`distributorId`, `isActive`),
  ADD UNIQUE INDEX `LocProductDisc_product_location_scope_key` (`productId`, `province`, `district`, `scopeKey`);

ALTER TABLE `LocationProductDiscount`
  ADD CONSTRAINT `LocationProductDiscount_distributorId_fkey`
  FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Order`
  ADD COLUMN `locationDiscountDistributorId` VARCHAR(191) NULL;
