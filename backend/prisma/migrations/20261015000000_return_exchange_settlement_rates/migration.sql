ALTER TABLE `ShippingConfig`
    ADD COLUMN `ncmReturnSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `ncmExchangeSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `distributorReturnSettlementRate` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `distributorExchangeSettlementRate` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `CustomerReturn`
    ADD COLUMN `logisticsSettlementAmount` DOUBLE NULL;

ALTER TABLE `OrderExchangeRequest`
    ADD COLUMN `logisticsSettlementAmount` DOUBLE NULL;
