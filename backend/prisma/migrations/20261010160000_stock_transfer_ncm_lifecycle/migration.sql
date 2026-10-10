ALTER TABLE `StockTransferShipment`
    ADD COLUMN `ncmOrderId` VARCHAR(64) NULL,
    ADD COLUMN `ncmLastEventAt` DATETIME(3) NULL;

UPDATE `StockTransferShipment` AS shipment
SET `ncmOrderId` = CAST(shipment.`externalReference` AS UNSIGNED)
WHERE shipment.`bookingMode` = 'NCM'
  AND shipment.`externalReference` REGEXP '^[0-9]+$'
  AND CAST(shipment.`externalReference` AS UNSIGNED) IN (
      SELECT `carrierOrderId`
      FROM (
          SELECT CAST(`externalReference` AS UNSIGNED) AS `carrierOrderId`
          FROM `StockTransferShipment`
          WHERE `bookingMode` = 'NCM'
            AND `externalReference` REGEXP '^[0-9]+$'
          GROUP BY CAST(`externalReference` AS UNSIGNED)
          HAVING COUNT(*) = 1
      ) AS unique_carrier_order_ids
  );

CREATE UNIQUE INDEX `StockTransferShipment_ncmOrderId_key`
    ON `StockTransferShipment` (`ncmOrderId`);

CREATE TABLE `StockTransferShipmentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `shipmentId` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `occurredAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StockTransferShipmentEvent_eventKey_key` (`eventKey`),
    INDEX `StockTransferShipmentEvent_shipmentId_occurredAt_idx` (`shipmentId`, `occurredAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `StockTransferShipmentEvent_shipmentId_fkey`
      FOREIGN KEY (`shipmentId`) REFERENCES `StockTransferShipment` (`id`)
      ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
