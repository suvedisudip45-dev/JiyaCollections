ALTER TABLE `StockTransferShipment`
    ADD COLUMN `packageWeight` DECIMAL(8,3) NULL,
    ADD COLUMN `packageType` VARCHAR(64) NULL,
    ADD COLUMN `productType` VARCHAR(120) NULL,
    ADD COLUMN `productDescription` VARCHAR(300) NULL,
    ADD COLUMN `packageDimensions` VARCHAR(120) NULL,
    ADD COLUMN `isFragile` BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN `deliveryInstruction` VARCHAR(500) NULL,
    ADD COLUMN `packagingNotes` VARCHAR(500) NULL;
