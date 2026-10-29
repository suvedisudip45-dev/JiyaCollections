ALTER TABLE `AccountingEvent`
    ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
    ADD COLUMN `claimedAt` DATETIME(3) NULL,
    ADD INDEX `AcctEvent_source_event_status_retry_created_idx`
        (`sourceType`, `eventType`, `status`, `nextAttemptAt`, `createdAt`);
