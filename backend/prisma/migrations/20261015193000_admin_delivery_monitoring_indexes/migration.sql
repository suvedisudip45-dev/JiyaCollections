CREATE INDEX `DeliveryOrder_createdAt_state_idx`
ON `DeliveryOrder`(`createdAt`, `state`);

ALTER TABLE `OrderAssignment`
ADD COLUMN `deliveryType` VARCHAR(191) NOT NULL DEFAULT 'SELF_DELIVERY';

CREATE INDEX `OrdAssign_type_dist_status_time_idx`
ON `OrderAssignment`(`deliveryType`, `distributorId`, `status`, `assignedAt`);
