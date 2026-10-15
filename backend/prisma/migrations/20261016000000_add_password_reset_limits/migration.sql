ALTER TABLE `AuthAccount`
  ADD COLUMN `passwordResetLastRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `passwordResetMonthlyKey` VARCHAR(7) NULL,
  ADD COLUMN `passwordResetMonthlyCount` INTEGER NOT NULL DEFAULT 0;
