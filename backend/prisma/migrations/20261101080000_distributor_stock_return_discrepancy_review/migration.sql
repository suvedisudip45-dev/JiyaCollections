CREATE TABLE `InventoryDiscrepancyReview` (
  `id` VARCHAR(191) NOT NULL,
  `discrepancyId` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `reviewedBy` VARCHAR(191) NOT NULL,
  `notes` TEXT NOT NULL,
  `evidence` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `InventoryDiscrepancyReview_idempotencyKey_key` (`idempotencyKey`),
  INDEX `InvDiscrepReview_discrepancy_date_idx` (`discrepancyId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `InventoryDiscrepancyReview_discrepancyId_fkey`
    FOREIGN KEY (`discrepancyId`) REFERENCES `InventoryDiscrepancy` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
