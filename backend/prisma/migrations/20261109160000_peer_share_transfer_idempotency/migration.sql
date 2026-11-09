ALTER TABLE `ShareTransaction`
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
  ADD COLUMN `requestPayloadHash` VARCHAR(64) NULL,
  ADD UNIQUE INDEX `ShareTransaction_idempotencyKey_key`(`idempotencyKey`);
