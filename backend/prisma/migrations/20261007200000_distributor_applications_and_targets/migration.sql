ALTER TABLE `Manufacturer`
    ADD COLUMN `distributorApplicationStatus` VARCHAR(191) NOT NULL DEFAULT 'NONE';

UPDATE `Manufacturer` AS manufacturer
LEFT JOIN `Distributor` AS distributor
    ON distributor.`accountId` = manufacturer.`accountId`
SET manufacturer.`distributorApplicationStatus` = CASE
    WHEN distributor.`status` = 'ACTIVE' AND distributor.`isActive` = true THEN 'APPROVED'
    WHEN distributor.`status` = 'REJECTED' THEN 'REJECTED'
    WHEN distributor.`id` IS NOT NULL THEN 'REQUESTED'
    ELSE 'NONE'
END;

INSERT INTO `AuthAccountRoleMapping` (`id`, `accountId`, `roleId`, `isActive`, `createdAt`, `updatedAt`)
SELECT UUID(), distributor.`accountId`, role.`id`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Distributor` AS distributor
JOIN `Role` AS role ON role.`code` = 'DISTRIBUTOR' AND role.`isActive` = true
WHERE distributor.`accountId` IS NOT NULL
    AND distributor.`status` = 'ACTIVE'
    AND distributor.`isActive` = true
ON DUPLICATE KEY UPDATE `isActive` = true, `updatedAt` = CURRENT_TIMESTAMP(3);

ALTER TABLE `OrderAssignment`
    MODIFY `manufacturerId` VARCHAR(191) NULL,
    ADD COLUMN `distributorId` VARCHAR(191) NULL,
    ADD INDEX `OrderAssignment_distributorId_idx` (`distributorId`);

UPDATE `OrderAssignment` AS assignment
JOIN `Manufacturer` AS manufacturer
    ON manufacturer.`id` = assignment.`manufacturerId`
JOIN `Distributor` AS distributor
    ON distributor.`accountId` = manufacturer.`accountId`
    AND distributor.`status` = 'ACTIVE'
    AND distributor.`isActive` = true
SET assignment.`distributorId` = distributor.`id`;

CREATE TABLE `DistributorLocation` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `province` VARCHAR(120) NOT NULL,
    `district` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DistributorLocation_distributorId_province_district_key` (`distributorId`, `province`, `district`),
    INDEX `DistributorLocation_province_district_isActive_idx` (`province`, `district`, `isActive`),
    INDEX `DistributorLocation_distributorId_isActive_idx` (`distributorId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DistributorDeliveryChargeNegotiation` (
    `id` VARCHAR(191) NOT NULL,
    `distributorId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `deliveryCharge` DECIMAL(20, 2) NOT NULL,
    `returnCharge` DECIMAL(20, 2) NOT NULL,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `vatInclusive` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `proposedByRole` VARCHAR(32) NOT NULL,
    `proposedByAccountId` VARCHAR(191) NULL,
    `reviewedByAccountId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `effectiveFrom` DATETIME(3) NULL,
    `effectiveUntil` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DistributorDeliveryChargeNegotiation_distributorId_status_effectiveFrom_idx` (`distributorId`, `status`, `effectiveFrom`),
    INDEX `DistributorDeliveryChargeNegotiation_productId_status_idx` (`productId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrderAssignment`
    ADD CONSTRAINT `OrderAssignment_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `DistributorLocation`
    ADD CONSTRAINT `DistributorLocation_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `DistributorDeliveryChargeNegotiation`
    ADD CONSTRAINT `DistributorDeliveryChargeNegotiation_distributorId_fkey`
    FOREIGN KEY (`distributorId`) REFERENCES `Distributor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `DistributorDeliveryChargeNegotiation_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
