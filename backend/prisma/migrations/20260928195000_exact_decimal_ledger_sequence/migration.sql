-- Convert authoritative general-ledger amounts from floating point to fixed-scale NPR precision.
ALTER TABLE `Account`
    MODIFY `currentBalance` DECIMAL(20, 2) NOT NULL DEFAULT 0;

ALTER TABLE `JournalEntry`
    MODIFY `totalDebit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `totalCredit` DECIMAL(20, 2) NOT NULL DEFAULT 0;

ALTER TABLE `JournalLine`
    MODIFY `debit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    MODIFY `credit` DECIMAL(20, 2) NOT NULL DEFAULT 0;

CREATE TABLE `JournalSequence` (
    `fiscalYear` INTEGER NOT NULL,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`fiscalYear`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;