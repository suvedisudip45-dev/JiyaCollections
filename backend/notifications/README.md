# Notification Worker

The notification subsystem is isolated from existing order, authentication, and OTP flows. No existing business flow automatically sends SMS or email.

## Runtime configuration

The API remains independent of RabbitMQ. Run the worker separately with `npm run worker:notifications`; the worker loads the standard backend `.env` and then `backend/.env.notifications`. Local secret files are ignored by Git. In production, inject configuration directly into a dedicated worker service through its secret manager. Never put real credentials in `.env.example` or frontend configuration.

The worker requires `NOTIFICATIONS_ENABLED=true` plus RabbitMQ connection values. TLS is required for production RabbitMQ. Enable SMS and email separately. Sparrow sending requires an HTTPS endpoint because credentials are sent to the provider. The current supplied endpoint uses HTTP, so SMS remains disabled until a secure endpoint is confirmed. SMTP sending requires a verified `SMTP_FROM` sender identity.

## Migration and deployment

Generate the Prisma client after reviewing the schema, then apply the checked-in migration in a staging database with Prisma Migrate. Do not use `db push` for production. Deploy the API first with notifications disabled, then deploy the worker with its RabbitMQ credentials. Notification sending becomes available only after both the migration and worker are operational.

## Delivery semantics

A notification and outbox record are committed in one database transaction. The worker uses persistent RabbitMQ messages, durable exchanges and queues, publisher confirms, manual consumer acknowledgements, bounded retries, and dead-letter queues. Processing is at-least-once; duplicate publishes are possible and provider effects cannot be guaranteed exactly once. Provider acceptance is recorded as `ACCEPTED`, not `DELIVERED`.

If a provider request times out or a worker disappears after the provider may have accepted the request, the notification becomes `UNKNOWN`; it is not automatically resent because doing so could send duplicates. Operators must reconcile ambiguous outcomes before retrying.

Retryable failures use bounded exponential backoff with jitter. Permanent failures are sent to the dead-letter queue. Insufficient Sparrow credits are stored as failed and are not retried automatically to avoid consuming attempts while the account has no credits.

## Incoming SMS

The Sparrow incoming callback is disabled by default. It only accepts exact source-IP matches and requires both an allowlist and an explicit indication that ingress rate limiting is enforced. Confirm the provider's stable callback IP ranges before enabling it. Incoming SMS is persisted and acknowledged, but business processing is not implemented.

## Current implementation limits

- No API endpoint is exposed for general notification creation; the service layer is available to future explicitly approved flows.
- SMS delivery is disabled by default and the current provided URL is HTTP; the provider refuses to transmit the token to non-HTTPS endpoints.
- SMTP is disabled by default until a verified sender is configured.
- The email adapter uses SMTP and captures message IDs; it does not receive delivered/open/bounce callbacks.
- Incoming SMS storage is implemented, but no business-action processor or reply sender is enabled.
- Retry of ambiguous provider outcomes is intentionally manual.
- No notification admin UI, metrics exporter, or automatic retention deletion is implemented.
- Broker/database integration requires staging validation; unit tests use mocks only.

## Security operations

The credentials provided during setup were exposed in plaintext and should be rotated before production use. The repository already contains a tracked `manufacturer/.env`; do not add secrets there. Rotate credentials currently stored in that file and remove it from Git tracking through an approved repository-security operation. The active RabbitMQ and provider credentials are only in the ignored local backend notification env file and were not copied here.
