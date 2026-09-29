-- Allow multiple accounting events of the same type for one source (e.g. partial receipts).
-- Idempotency is enforced only by the stable per-event idempotencyKey.
ALTER TABLE `AccountingEvent`
    DROP INDEX `AccountingEvent_sourceType_sourceId_sourceVersion_eventType_key`;