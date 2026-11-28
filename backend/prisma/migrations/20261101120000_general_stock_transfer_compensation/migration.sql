ALTER TABLE `DistributorDeliveryChargeNegotiation`
  CHANGE COLUMN `ncmTransferCharge` `stockTransferCharge` DECIMAL(20, 2) NOT NULL DEFAULT 0;
