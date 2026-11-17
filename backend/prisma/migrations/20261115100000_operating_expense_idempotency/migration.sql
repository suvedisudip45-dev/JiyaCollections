ALTER TABLE `OperatingExpense`
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `requestPayloadHash` CHAR(64) NULL;

CREATE UNIQUE INDEX `OperatingExpense_idempotencyKey_key`
    ON `OperatingExpense`(`idempotencyKey`);
