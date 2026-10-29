ALTER TABLE `CashTransaction`
    ADD COLUMN `externalPaymentReference` VARCHAR(191) NULL;

ALTER TABLE `ManufacturerSettlementRequest`
    ADD COLUMN `externalPaymentReference` VARCHAR(191) NULL;

ALTER TABLE `DistributorSettlementRequest`
    ADD COLUMN `externalPaymentReference` VARCHAR(191) NULL;
