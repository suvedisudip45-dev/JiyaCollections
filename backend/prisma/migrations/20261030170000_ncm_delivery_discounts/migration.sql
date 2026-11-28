ALTER TABLE `DeliveryOrder`
  ADD COLUMN `ncmDeliveryChargeBeforeDiscount` DOUBLE NULL,
  ADD COLUMN `ncmDeliveryDiscount` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `DeliveryFinancialSettlement`
  ADD COLUMN `deliveryFeeDiscount` DOUBLE NOT NULL DEFAULT 0;
