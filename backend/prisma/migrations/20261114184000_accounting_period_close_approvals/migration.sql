CREATE TABLE `AccountingPeriodCloseEvent` (
  `id` VARCHAR(191) NOT NULL,
  `accountingPeriodId` VARCHAR(191) NOT NULL,
  `sequence` INTEGER NOT NULL,
  `cycle` INTEGER NOT NULL,
  `eventType` VARCHAR(32) NOT NULL,
  `requestKey` VARCHAR(191) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `actorAccountId` VARCHAR(191) NOT NULL,
  `actorRole` VARCHAR(32) NOT NULL,
  `subjectSequence` INTEGER NULL,
  `checklistSnapshot` JSON NULL,
  `reason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingPeriodCloseEvent_requestKey_key` (`requestKey`),
  UNIQUE INDEX `AccountingPeriodCloseEvent_accountingPeriodId_sequence_key` (`accountingPeriodId`, `sequence`),
  INDEX `AccountingPeriodCloseEvent_accountingPeriodId_cycle_sequence_idx` (`accountingPeriodId`, `cycle`, `sequence`),
  CONSTRAINT `AccountingPeriodCloseEvent_accountingPeriodId_fkey`
    FOREIGN KEY (`accountingPeriodId`) REFERENCES `AccountingPeriod` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
