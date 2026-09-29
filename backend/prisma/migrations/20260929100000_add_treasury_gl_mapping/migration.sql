-- Add nullable mapping so existing Treasury balances are not assigned an assumed accounting treatment.
ALTER TABLE `FinancialAccount`
  ADD COLUMN `accountingAccountId` VARCHAR(191) NULL;

CREATE INDEX `FinancialAccount_accountingAccountId_idx`
  ON `FinancialAccount`(`accountingAccountId`);

ALTER TABLE `FinancialAccount`
  ADD CONSTRAINT `FinancialAccount_accountingAccountId_fkey`
  FOREIGN KEY (`accountingAccountId`) REFERENCES `Account`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
