ALTER TABLE `DistributorDeliveryChargeNegotiation`
  ADD COLUMN `counterSaleCharge` DECIMAL(20, 2) NOT NULL DEFAULT 0;

ALTER TABLE `DistributorServiceEarning`
  ADD COLUMN `appliedReversalAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0;
