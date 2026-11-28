-- Additive Phase 3 route, proof-of-delivery, offline sync, and peer custody models.

ALTER TABLE `StockTransfer`
  MODIFY COLUMN `manufacturerId` VARCHAR(191) NULL,
  ADD COLUMN `transferKind` VARCHAR(191) NOT NULL DEFAULT 'FACTORY_TO_DISTRIBUTOR',
  ADD COLUMN `sourceDistributorId` VARCHAR(191) NULL,
  ADD INDEX `StockTransfer_sourceDistributorId_idx`(`sourceDistributorId`);

ALTER TABLE `StockTransfer`
  ADD CONSTRAINT `StockTransfer_sourceDistributorId_fkey`
  FOREIGN KEY (`sourceDistributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `DeliveryDriver` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `accountId` VARCHAR(191) NULL,
  `name` VARCHAR(120) NOT NULL,
  `phone` VARCHAR(40) NOT NULL,
  `licenseNumber` VARCHAR(64) NULL,
  `vehicleType` VARCHAR(64) NULL,
  `vehicleRegistration` VARCHAR(64) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DeliveryDriver_accountId_key`(`accountId`),
  INDEX `DeliveryDriver_distributorId_status_idx`(`distributorId`,`status`),
  INDEX `DeliveryDriver_phone_idx`(`phone`),
  CONSTRAINT `DeliveryDriver_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DeliveryRouteManifest` (
  `id` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `driverId` VARCHAR(191) NULL,
  `manifestCode` VARCHAR(32) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PREPARING',
  `priority` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
  `plannedStartAt` DATETIME(3) NULL,
  `plannedEndAt` DATETIME(3) NULL,
  `dispatchedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `optimizationSnapshot` JSON NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdByAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DeliveryRouteManifest_manifestCode_key`(`manifestCode`),
  UNIQUE INDEX `DeliveryRouteManifest_idempotencyKey_key`(`idempotencyKey`),
  INDEX `DeliveryRouteManifest_distributorId_status_createdAt_idx`(`distributorId`,`status`,`createdAt`),
  INDEX `DeliveryRouteManifest_driverId_status_idx`(`driverId`,`status`),
  CONSTRAINT `DeliveryRouteManifest_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `DeliveryRouteManifest_driverId_fkey`
    FOREIGN KEY (`driverId`) REFERENCES `DeliveryDriver`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DeliveryManifestStop` (
  `id` VARCHAR(191) NOT NULL,
  `manifestId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `assignmentId` VARCHAR(191) NULL,
  `stopSequence` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `priority` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
  `timeWindowStart` DATETIME(3) NULL,
  `timeWindowEnd` DATETIME(3) NULL,
  `recipientNameSnapshot` VARCHAR(191) NULL,
  `addressSnapshot` JSON NULL,
  `parcelCount` INTEGER NOT NULL DEFAULT 1,
  `dispatchedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DeliveryManifestStop_manifestId_orderId_key`(`manifestId`,`orderId`),
  UNIQUE INDEX `DeliveryManifestStop_manifestId_stopSequence_key`(`manifestId`,`stopSequence`),
  UNIQUE INDEX `DeliveryManifestStop_idempotencyKey_key`(`idempotencyKey`),
  INDEX `DeliveryManifestStop_assignmentId_idx`(`assignmentId`),
  INDEX `DeliveryManifestStop_orderId_idx`(`orderId`),
  INDEX `DeliveryManifestStop_manifestId_status_stopSequence_idx`(`manifestId`,`status`,`stopSequence`),
  CONSTRAINT `DeliveryManifestStop_manifestId_fkey`
    FOREIGN KEY (`manifestId`) REFERENCES `DeliveryRouteManifest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DeliveryProofOfDelivery` (
  `id` VARCHAR(191) NOT NULL,
  `stopId` VARCHAR(191) NOT NULL,
  `outcome` VARCHAR(32) NOT NULL,
  `recipientName` VARCHAR(191) NOT NULL,
  `signaturePath` TEXT NULL,
  `photoPath` TEXT NULL,
  `latitude` DECIMAL(10,7) NULL,
  `longitude` DECIMAL(10,7) NULL,
  `deviceTimestamp` DATETIME(3) NULL,
  `verifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notes` TEXT NULL,
  `failedReason` VARCHAR(191) NULL,
  `partialQuantity` INTEGER NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `actorAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `DeliveryProofOfDelivery_stopId_key`(`stopId`),
  UNIQUE INDEX `DeliveryProofOfDelivery_idempotencyKey_key`(`idempotencyKey`),
  INDEX `DeliveryProofOfDelivery_outcome_verifiedAt_idx`(`outcome`,`verifiedAt`),
  INDEX `DeliveryProofOfDelivery_actorAccountId_idx`(`actorAccountId`),
  CONSTRAINT `DeliveryProofOfDelivery_stopId_fkey`
    FOREIGN KEY (`stopId`) REFERENCES `DeliveryManifestStop`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OfflineDeliverySyncDraft` (
  `id` VARCHAR(191) NOT NULL,
  `manifestId` VARCHAR(191) NOT NULL,
  `stopId` VARCHAR(191) NOT NULL,
  `clientDraftId` VARCHAR(191) NOT NULL,
  `operationHash` VARCHAR(64) NOT NULL,
  `payloadSnapshot` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `conflictDetails` JSON NULL,
  `reconciledAt` DATETIME(3) NULL,
  `reconciledByAccountId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `OfflineDeliverySyncDraft_clientDraftId_key`(`clientDraftId`),
  INDEX `OfflineDeliverySyncDraft_manifestId_status_createdAt_idx`(`manifestId`,`status`,`createdAt`),
  INDEX `OfflineDeliverySyncDraft_stopId_status_idx`(`stopId`,`status`),
  CONSTRAINT `OfflineDeliverySyncDraft_manifestId_fkey`
    FOREIGN KEY (`manifestId`) REFERENCES `DeliveryRouteManifest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `OfflineDeliverySyncDraft_stopId_fkey`
    FOREIGN KEY (`stopId`) REFERENCES `DeliveryManifestStop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PeerStockTransferCustodyEvent` (
  `id` VARCHAR(191) NOT NULL,
  `stockTransferId` VARCHAR(191) NOT NULL,
  `distributorId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(32) NOT NULL,
  `custodyStage` VARCHAR(32) NOT NULL,
  `responsibilityParty` VARCHAR(32) NOT NULL,
  `details` TEXT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `actorAccountId` VARCHAR(191) NULL,
  `evidence` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PeerStockTransferCustodyEvent_idempotencyKey_key`(`idempotencyKey`),
  INDEX `PeerStockTransferCustodyEvent_stockTransferId_createdAt_idx`(`stockTransferId`,`createdAt`),
  INDEX `PeerStockTransferCustodyEvent_distributorId_custodyStage_createdAt_idx`(`distributorId`,`custodyStage`,`createdAt`),
  CONSTRAINT `PeerStockTransferCustodyEvent_stockTransferId_fkey`
    FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PeerStockTransferCustodyEvent_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
