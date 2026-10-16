ALTER TABLE `ManufacturerProductionRequest`
    ADD COLUMN `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'EXEMPT',
    ADD COLUMN `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13.00,
    ADD COLUMN `vatInvoiceReference` VARCHAR(120) NULL,
    ADD COLUMN `approvedVatTreatment` VARCHAR(24) NOT NULL DEFAULT 'EXEMPT',
    ADD COLUMN `approvedVatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13.00,
    ADD COLUMN `approvedVatInvoiceReference` VARCHAR(120) NULL,
    ADD COLUMN `approvedVatInvoiceVerified` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `ManufacturerInventoryCostLayer`
    ADD COLUMN `unitVatAmount` DECIMAL(30, 14) NOT NULL DEFAULT 0,
    ADD COLUMN `vatTreatment` VARCHAR(24) NOT NULL DEFAULT 'EXEMPT',
    ADD COLUMN `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 13.00,
    ADD COLUMN `vatInvoiceVerified` BOOLEAN NOT NULL DEFAULT false;
