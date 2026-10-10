ALTER TABLE `StockTransferShipment`
    ADD COLUMN `ncmStatus` VARCHAR(191) NULL,
    ADD COLUMN `ncmStatusHistory` JSON NULL,
    ADD COLUMN `ncmPaymentStatus` VARCHAR(64) NULL,
    ADD COLUMN `ncmLastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `ncmReturnStatus` VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUESTED',
    ADD COLUMN `ncmReturnReason` TEXT NULL,
    ADD COLUMN `ncmReturnRequestedAt` DATETIME(3) NULL;
