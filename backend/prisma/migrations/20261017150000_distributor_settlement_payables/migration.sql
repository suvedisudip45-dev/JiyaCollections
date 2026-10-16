ALTER TABLE `DistributorSettlementRequest`
    ADD COLUMN `paidAmount` DECIMAL(20, 2) NOT NULL DEFAULT 0;
