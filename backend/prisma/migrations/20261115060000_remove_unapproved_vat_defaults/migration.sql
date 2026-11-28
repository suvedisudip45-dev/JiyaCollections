ALTER TABLE `TaxConfiguration`
    ALTER COLUMN `vatRate` SET DEFAULT 0;

ALTER TABLE `ManufacturerProductionRequest`
    ALTER COLUMN `vatRate` SET DEFAULT 0,
    ALTER COLUMN `approvedVatRate` SET DEFAULT 0;

ALTER TABLE `ManufacturerInventoryCostLayer`
    ALTER COLUMN `vatRate` SET DEFAULT 0;

ALTER TABLE `DistributorDeliveryChargeNegotiation`
    ALTER COLUMN `vatRate` SET DEFAULT 0;
