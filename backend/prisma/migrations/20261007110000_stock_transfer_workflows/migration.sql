-- Add shipment booking, admin freight settlement tracking, and idempotent receipt support.
ALTER TABLE `StockTransferLine`
    ADD COLUMN `reservedShipmentQuantity` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `StockTransferShipmentLine`
    ADD COLUMN `uncostedQuantity` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `StockTransferShipment`
    ADD COLUMN `bookingMode` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `bookingIdempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `bookingRequestHash` VARCHAR(64) NULL,
    ADD COLUMN `freightCharge` DECIMAL(20, 2) NULL,
    ADD COLUMN `freightSettlementStatus` VARCHAR(64) NOT NULL DEFAULT 'PENDING_ADMIN_SETTLEMENT',
    ADD UNIQUE INDEX `StockTransferShipment_bookingIdempotencyKey_key` (`bookingIdempotencyKey`);

ALTER TABLE `StockTransferReceipt`
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `requestHash` VARCHAR(64) NULL,
    ADD UNIQUE INDEX `StockTransferReceipt_idempotencyKey_key` (`idempotencyKey`);

CREATE TABLE `StockTransferShipmentLineCostLayer` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentLineId` VARCHAR(191) NOT NULL,
    `costLayerId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'RESERVED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockTransferShipmentLineCostLayer_shipmentLineId_costLayerId_key` (`shipmentLineId`, `costLayerId`),
    INDEX `StockTransferShipmentLineCostLayer_costLayerId_status_idx` (`costLayerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Permission` (`id`, `code`, `description`, `isActive`, `createdAt`, `updatedAt`)
SELECT UUID(), permissions.code, permissions.description, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
    SELECT 'transfer:distributor_request' AS code, 'Request bulk stock from a manufacturer.' AS description
    UNION ALL SELECT 'transfer:distributor_read', 'Read transfers addressed to the active distributor.'
    UNION ALL SELECT 'transfer:distributor_receive', 'Record receipt of bulk stock shipments.'
    UNION ALL SELECT 'transfer:manufacturer_read', 'Read manufacturer-originated stock transfers.'
    UNION ALL SELECT 'transfer:manufacturer_dispatch', 'Book and dispatch approved bulk stock transfers.'
    UNION ALL SELECT 'transfer:admin_read', 'Read all platform stock transfers.'
    UNION ALL SELECT 'transfer:admin_review', 'Approve and review stock transfer requests and shipment exceptions.'
) AS permissions
WHERE NOT EXISTS (
    SELECT 1 FROM `Permission` existing WHERE existing.`code` = permissions.code
);

INSERT INTO `RolePermissionMapping` (`id`, `roleId`, `permissionId`, `createdAt`)
SELECT UUID(), roles.id, permissions.id, CURRENT_TIMESTAMP(3)
FROM `Role` roles
JOIN `Permission` permissions
WHERE
    (roles.`code` = 'ADMIN' AND permissions.`code` LIKE 'transfer:%')
    OR (roles.`code` = 'MANUFACTURER' AND permissions.`code` IN ('transfer:manufacturer_read', 'transfer:manufacturer_dispatch'))
    OR (roles.`code` = 'DISTRIBUTOR' AND permissions.`code` IN ('transfer:distributor_request', 'transfer:distributor_read', 'transfer:distributor_receive'))
ON DUPLICATE KEY UPDATE `permissionId` = VALUES(`permissionId`);

ALTER TABLE `StockTransferShipmentLineCostLayer`
    ADD CONSTRAINT `StockTransferShipmentLineCostLayer_shipmentLineId_fkey`
    FOREIGN KEY (`shipmentLineId`) REFERENCES `StockTransferShipmentLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `StockTransferShipmentLineCostLayer_costLayerId_fkey`
    FOREIGN KEY (`costLayerId`) REFERENCES `ManufacturerInventoryCostLayer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
