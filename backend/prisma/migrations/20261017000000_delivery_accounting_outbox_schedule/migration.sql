ALTER TABLE `AccountingEvent`
    ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
    ADD COLUMN `claimedAt` DATETIME(3) NULL,
    ADD INDEX `AccountingEvent_sourceType_eventType_status_nextAttemptAt_createdAt_idx`
        (`sourceType`, `eventType`, `status`, `nextAttemptAt`, `createdAt`);
