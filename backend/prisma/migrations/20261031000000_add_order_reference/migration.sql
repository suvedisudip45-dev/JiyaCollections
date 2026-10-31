ALTER TABLE `Order`
  ADD COLUMN `orderReference` VARCHAR(15) NULL;

UPDATE `Order`
SET `orderReference` = UPPER(RIGHT(REPLACE(`id`, '-', ''), 15));

ALTER TABLE `Order`
  MODIFY COLUMN `orderReference` VARCHAR(15) NOT NULL,
  ADD UNIQUE INDEX `Order_orderReference_key` (`orderReference`);
