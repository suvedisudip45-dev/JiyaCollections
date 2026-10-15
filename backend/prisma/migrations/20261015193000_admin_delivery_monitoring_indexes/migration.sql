CREATE INDEX `DeliveryOrder_createdAt_state_idx`
ON `DeliveryOrder`(`createdAt`, `state`);

CREATE INDEX `OrderAssignment_deliveryType_distributorId_status_assignedAt_idx`
ON `OrderAssignment`(`deliveryType`, `distributorId`, `status`, `assignedAt`);
