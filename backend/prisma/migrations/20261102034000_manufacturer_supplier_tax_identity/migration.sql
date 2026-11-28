ALTER TABLE `Manufacturer`
    ADD COLUMN `taxIdType` VARCHAR(8) NULL,
    ADD COLUMN `taxIdNumber` VARCHAR(9) NULL,
    ADD UNIQUE INDEX `Manufacturer_taxIdNumber_key` (`taxIdNumber`);

ALTER TABLE `ManufacturerProductionRequest`
    ADD COLUMN `approvedSupplierTaxIdType` VARCHAR(8) NULL,
    ADD COLUMN `approvedSupplierTaxIdNumber` VARCHAR(9) NULL;

ALTER TABLE `AccountingDocument`
    ADD COLUMN `partyTaxIdType` VARCHAR(8) NULL,
    ADD COLUMN `partyTaxIdNumber` VARCHAR(9) NULL;
