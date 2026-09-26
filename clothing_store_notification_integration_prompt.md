# Clothing Store — Production Notification System Integration Prompt

## Role

Act as a **principal/senior backend engineer with 18+ years of production software engineering experience**, with deep practical expertise in:

- Node.js
- TypeScript
- modern JavaScript frameworks
- REST APIs
- relational databases
- RabbitMQ / AMQP
- distributed systems
- asynchronous processing
- transactional messaging
- email/SMS infrastructure
- retries and dead-letter queues
- observability
- application security
- high-availability systems
- idempotency and exactly-once-effect design
- production incident prevention

You are working on an **existing Clothing Store application**.

Your job is to design and implement a production-quality notification subsystem **without breaking, refactoring, or changing unrelated existing functionality**.

---

# 1. PRIMARY OBJECTIVE

Integrate a dedicated notification subsystem into the existing Clothing Store application.

The initial scope is:

1. Notification core
2. SMS service abstraction
3. Email service abstraction
4. RabbitMQ message broker
5. Durable notification persistence
6. Retry handling
7. RabbitMQ DLX/DLQ handling
8. Failed-notification recovery
9. Scheduled retry/reprocessing
10. Notification audit/history
11. Provider response tracking
12. Incoming SMS/Pull notification foundation
13. Security and configuration management

### IMPORTANT CURRENT-SCOPE RESTRICTION

For this first implementation:

- Build the SMS integration.
- Build the email integration.
- **Do NOT actively send SMS from application business flows yet.**
- The SMS provider has very limited credits and SMS will be manually tested later.
- The SMS provider adapter should therefore be implemented and testable without automatically consuming SMS credits.
- Email infrastructure may be tested according to the existing project's safe development/test conventions.
- Do not add notification calls to unrelated existing business functionality unless explicitly required by a later task.

The architecture must make it easy to enable SMS sending later without restructuring the notification subsystem.

---

# 2. FIRST RULE — ANALYZE THE ENTIRE EXISTING PROJECT BEFORE TOUCHING CODE

Before changing any file, inspect the complete project architecture.

Do NOT start implementing immediately.

First understand:

- project structure
- backend framework
- frontend framework if relevant
- Node.js version
- TypeScript configuration
- package manager
- database
- ORM/query builder
- existing migration strategy
- existing entity/model conventions
- existing module/service architecture
- dependency injection pattern
- configuration/environment strategy
- validation strategy
- error-handling strategy
- logging
- authentication
- authorization
- existing schedulers/jobs
- existing queue/message-broker code
- existing email/SMS/notification functionality
- existing API conventions
- existing tests
- test framework
- deployment configuration
- Docker configuration
- CI/CD
- health checks
- observability
- existing security controls

Search the entire repository for existing:

```text
notification
notifications
email
mail
sms
rabbit
rabbitmq
amqp
queue
worker
job
scheduler
cron
dlq
dlx
dead-letter
retry
webhook
provider
message
event
outbox
```

Also inspect database migrations and existing tables before creating anything.

## Architecture-analysis requirement

Before implementation, produce an internal architecture assessment containing:

1. Existing architecture
2. Existing relevant modules
3. Existing database design
4. Existing queue/job infrastructure
5. Existing configuration system
6. Existing scheduler infrastructure
7. Existing API patterns
8. Existing security patterns
9. Where the notification subsystem should live
10. Files/modules that must NOT be modified
11. Potential compatibility risks
12. Recommended integration boundary

Do not modify code during this analysis phase.

If an existing subsystem can safely be reused, reuse it rather than creating a competing implementation.

---

# 3. NON-NEGOTIABLE SAFETY RULE

Do not alter unrelated application behavior.

Do NOT:

- refactor unrelated modules
- rename unrelated tables
- modify existing authentication behavior
- modify authorization behavior
- change existing business logic
- change existing API contracts
- upgrade dependencies unnecessarily
- change database conventions
- replace the existing ORM
- replace the existing queue library
- replace the existing scheduler
- reorganize the whole repository

Only introduce the minimum architecture necessary for the notification subsystem.

If an existing component needs a small extension, make the smallest compatible change.

---

# 4. IMPORTANT CREDENTIAL/SECRET RULE

All provider credentials and infrastructure credentials MUST come from environment variables/configuration.

NEVER hardcode:

- SMS token
- SMS base URL
- SMS sender identity
- RabbitMQ host
- RabbitMQ username
- RabbitMQ password
- RabbitMQ virtual host
- SMTP username
- SMTP password
- encryption keys
- webhook secrets
- API keys

The credentials supplied separately by the project owner are development credentials/configuration and must be placed in the appropriate local/server environment files or secret manager.

Do not copy the secret values into:

- source code
- TypeScript/JavaScript files
- migrations
- tests
- README
- Docker image
- Git history
- frontend bundles
- logs
- error messages
- generated documentation

Use `.env.example` with safe placeholders only.

### SECURITY ACTION

Because infrastructure credentials have been shared in plaintext during setup, treat them as exposed credentials. Recommend rotating them before production deployment.

Do not print the actual secret values in generated code or documentation.

---

# 5. CONFIGURATION

Create a clean notification configuration section.

Conceptually:

```yaml
otp:
  expiry-minutes: 5
  length: 6

sms:
  sender: ${SMS_SENDER}
  token: ${SMS_TOKEN}
  base_url: ${SMS_BASE_URL}

rabbitmq:
  host: ${RABBITMQ_HOST}
  port: ${RABBITMQ_PORT}
  username: ${RABBITMQ_USERNAME}
  password: ${RABBITMQ_PASSWORD}
  virtual-host: ${RABBITMQ_VIRTUAL_HOST}
  ssl:
    enabled: ${RABBITMQ_SSL_ENABLED}

mail:
  host: ${MAIL_HOST}
  port: ${MAIL_PORT}
  username: ${MAIL_USERNAME}
  password: ${MAIL_PASSWORD}
  properties:
    mail:
      smtp:
        auth: true
        starttls:
          enable: true
```

Adapt the exact syntax to the existing project's configuration convention.

Do not blindly introduce YAML if the existing application uses `.env`, JSON, TOML, or another configuration mechanism.

Use the project's established configuration architecture.

---

# 6. NOTIFICATION MODULE STRUCTURE

Create a dedicated notification area.

The exact path must follow the existing project's architecture, but conceptually use:

```text
src/
└── notification/
    ├── notification/
    │   ├── notification.service.ts
    │   ├── notification.controller.ts
    │   ├── notification.types.ts
    │   ├── notification.constants.ts
    │   ├── notification.mapper.ts
    │   └── notification.module.ts
    │
    ├── sms/
    │   ├── sms.service.ts
    │   ├── sms.provider.ts
    │   ├── sparrow-sms.provider.ts
    │   ├── sms.types.ts
    │   ├── sms.mapper.ts
    │   └── sms.constants.ts
    │
    ├── email/
    │   ├── email.service.ts
    │   ├── email.provider.ts
    │   ├── smtp-email.provider.ts
    │   ├── email.types.ts
    │   ├── email.mapper.ts
    │   └── email.constants.ts
    │
    ├── queue/
    │   ├── notification.publisher.ts
    │   ├── notification.consumer.ts
    │   ├── notification.retry.ts
    │   ├── notification.dlx.ts
    │   ├── notification.dlq.ts
    │   └── notification.queue.constants.ts
    │
    ├── scheduler/
    │   ├── notification-retry.scheduler.ts
    │   └── notification-reconciliation.scheduler.ts
    │
    ├── webhook/
    │   ├── sms-incoming.controller.ts
    │   ├── email-events.controller.ts
    │   └── webhook.security.ts
    │
    ├── persistence/
    │   ├── notification.repository.ts
    │   ├── notification-attempt.repository.ts
    │   └── notification-event.repository.ts
    │
    └── templates/
        └── ...
```

This is a conceptual structure.

Adapt filenames and directories to the existing project conventions.

The goal is strong separation of responsibility:

```text
notification/
    core orchestration

sms/
    SMS provider implementation

email/
    email provider implementation

queue/
    RabbitMQ infrastructure

scheduler/
    retry/reconciliation jobs

webhook/
    external provider callbacks

persistence/
    notification database access

templates/
    notification content/templates
```

---

# 7. CORE DESIGN PRINCIPLE

Use this logical architecture:

```text
Business/Application Layer
          |
          v
Notification Service
          |
          v
Persistent Notification Record
          |
          v
Transactional Outbox / Reliable Publisher
          |
          v
RabbitMQ
          |
          +------------------+
          |                  |
          v                  v
     SMS Consumer       Email Consumer
          |                  |
          v                  v
   Sparrow SMS          SMTP/Brevo
          |                  |
          v                  v
   Provider Result      Provider Result
          |                  |
          +--------+---------+
                   |
                   v
          Notification Status
                   |
                   v
        Provider Event/Webhook
        when supported
                   |
                   v
       Delivered / Bounced /
       Failed / etc.
```

The database is the source of truth for notification state.

RabbitMQ is the asynchronous transport mechanism.

Provider responses are external delivery evidence.

---

# 8. USE THE TRANSACTIONAL OUTBOX PATTERN WHERE APPROPRIATE

If the existing application uses a relational database, strongly prefer a transactional outbox for reliable publication.

The problem to prevent is:

```text
DB transaction commits
        +
application crashes
        =
notification never published
```

Instead:

```text
DB transaction
    |
    +-- business change
    |
    +-- notification record
    |
    +-- outbox event
    |
    COMMIT
         |
         v
Outbox publisher
         |
         v
RabbitMQ
```

The outbox publisher may publish an event more than once if it crashes after publishing but before marking the outbox record as published.

Therefore consumers MUST be idempotent.

Do not claim true exactly-once delivery.

Design for:

> at-least-once message processing + idempotent notification effects.

This is the production-safe model.

---

# 9. DATABASE DESIGN

Create a proper persistent notification model.

Do not store only a simple `sent = true/false`.

The system needs lifecycle information.

At minimum create a `notifications` table/entity.

Recommended fields conceptually:

```text
id
notification_type
channel
status

recipient_name
recipient_address
recipient_phone
recipient_email

subject
template
payload

provider
provider_message_id

priority

attempt_count
max_attempts

next_retry_at
last_attempt_at

queued_at
sent_at
delivered_at
failed_at

failure_code
failure_reason

created_at
updated_at
```

Adapt naming/types to the existing database conventions.

---

# 10. NOTIFICATION STATUS MODEL

Use explicit statuses.

Recommended conceptual lifecycle:

```text
PENDING
   |
   v
QUEUED
   |
   v
PROCESSING
   |
   +----------------------+
   |                      |
   v                      v
SENT/ACCEPTED          FAILED
   |                      |
   v                      |
DELIVERED                 |
                          v
                       RETRYING
                          |
                          v
                       QUEUED
                          |
                          v
                     MAX RETRIES
                          |
                          v
                    DEAD_LETTERED
```

Important distinction:

### QUEUED

The application accepted the notification for asynchronous processing.

### SENT / ACCEPTED

The provider accepted the request.

This does NOT necessarily mean the recipient received the message.

### DELIVERED

The external provider has confirmed delivery where such confirmation is available.

### FAILED

The provider/application reports a failure.

### DEAD_LETTERED

The message exhausted configured retry policy or was permanently rejected and requires manual/reconciliation handling.

---

# 11. STORE NOTIFICATION ATTEMPTS SEPARATELY

Do not overwrite the complete history on every retry.

Create a notification-attempt table.

Conceptually:

```text
notification_attempts

id
notification_id

attempt_number

status

provider
provider_message_id

request_started_at
request_finished_at

http_status
provider_status
provider_error_code
provider_error_message

failure_category

created_at
```

This allows operators to answer:

- how many times was this attempted?
- when did each attempt occur?
- which provider response was received?
- why did attempt #1 fail?
- did attempt #2 succeed?
- was the failure transient or permanent?

Never store provider credentials in this table.

Avoid storing full sensitive message bodies if unnecessary.

---

# 12. STORE PROVIDER EVENTS

Create a notification event/history model if appropriate.

Conceptually:

```text
notification_events

id
notification_id

event_type

provider
provider_event_id
provider_message_id

event_timestamp

payload_hash
raw_payload_reference

created_at
```

If raw provider payloads must be retained, apply appropriate security/privacy controls.

Do not blindly store sensitive webhook payloads forever.

Use event IDs/provider IDs for idempotency.

---

# 13. RECIPIENT DATA

Store recipient information needed for auditing and delivery reconciliation.

Examples:

```text
recipient_phone
recipient_email
```

However:

- do not expose recipient information unnecessarily through APIs
- do not log full recipient details at normal log levels
- mask sensitive values in logs
- consider encryption/hashing/tokenization if the project's data protection requirements require it

---

# 14. IDEMPOTENCY

This is mandatory.

A RabbitMQ message can be delivered more than once.

The notification consumer must therefore be safe against duplicate processing.

Use:

```text
notification.id
```

or a dedicated:

```text
idempotency_key
```

as the logical identity.

Before performing an external provider side effect, determine whether the attempt has already been processed.

Also consider provider-specific idempotency support where available.

Do not implement unsafe logic such as:

```text
consume message
send SMS
then check if already processed
```

because that can still duplicate the external message.

Design the state transitions carefully.

Document the unavoidable distributed-systems limitation:

> If a provider accepts a message and the application crashes before persisting the acceptance result, the application may not know whether a retry would duplicate the notification.

Where the provider supports idempotency keys, use them.

Where it does not, use stable notification/attempt identifiers and reconciliation to minimize ambiguity.

---

# 15. RABBITMQ ARCHITECTURE

Use RabbitMQ for asynchronous notification delivery.

Create clearly named exchanges and queues.

Conceptually:

```text
notification.exchange
    |
    +-- notification.sms
    |       |
    |       v
    |   notification.sms.queue
    |
    +-- notification.email
            |
            v
        notification.email.queue
```

Also establish dead-letter infrastructure:

```text
notification.exchange
        |
        v
notification.sms.queue
        |
        | failure / reject / TTL
        v
notification.dlx
        |
        v
notification.sms.dlq
```

and:

```text
notification.email.queue
        |
        v
notification.dlx
        |
        v
notification.email.dlq
```

Use durable exchanges and durable queues.

Use persistent messages.

Use explicit acknowledgements.

Do not auto-ack before successful processing.

---

# 16. DLX/DLQ DESIGN

Use RabbitMQ Dead Letter Exchange (DLX) and Dead Letter Queues (DLQ).

DLQ is not a replacement for application-level retry logic.

Separate:

### Transient failure

Examples:

- temporary provider outage
- network timeout
- DNS failure
- HTTP 5xx
- SMTP temporary failure
- RabbitMQ consumer infrastructure issue

These should be retried.

### Permanent failure

Examples:

- invalid recipient
- invalid sender
- invalid provider credentials
- malformed request
- unsupported destination
- account inactive
- no SMS credits
- invalid email address when known to be permanent

These generally should NOT be retried indefinitely.

Classify errors explicitly.

---

# 17. RETRY STRATEGY

Use bounded retries.

Do NOT create an infinite retry loop.

Use configurable exponential backoff with jitter.

Conceptually:

```text
attempt 1 -> immediate
attempt 2 -> 30s
attempt 3 -> 2m
attempt 4 -> 10m
attempt 5 -> 30m
then DLQ
```

These are example values only.

Make the values configurable.

Use jitter to avoid synchronized retry storms.

Conceptually:

```text
delay = exponentialBackoff(attempt) + randomJitter
```

Do not retry permanent failures.

---

# 18. IMPORTANT: DLQ IS NOT THE SAME AS RETRY QUEUE

Do not implement:

```text
main queue -> DLQ -> immediately requeue forever
```

That can create a hot failure loop.

Instead use:

```text
main queue
    |
    v
processing failure
    |
    +-- transient --> retry mechanism
    |
    +-- permanent --> DLQ
    |
    +-- max retries --> DLQ
```

For scheduled retry/recovery:

```text
DLQ
 |
 v
Retry Scheduler
 |
 | inspect notification
 | determine retry eligibility
 |
 v
publish back to main queue
 |
 v
main queue
```

---

# 19. USER REQUEST: SCHEDULED DLQ PROCESSING

The system must include a scheduler that checks dead-lettered/failed notifications.

The user specifically wants retry execution at varying/random times.

Implement this safely.

Do NOT make retry timing random without bounds.

Use:

```text
retry_after / next_retry_at
```

stored in the database.

The scheduler can run periodically and select eligible notifications:

```sql
WHERE status IN (...)
AND next_retry_at <= NOW()
AND attempt_count < max_attempts
```

Use a bounded randomized delay/jitter when calculating `next_retry_at`.

For example:

```text
base retry delay
+
random jitter within configured bounds
```

This prevents all failed messages from retrying simultaneously.

The scheduler should:

1. find eligible failed/dead-lettered notifications
2. lock/claim them safely
3. prevent multiple application instances from processing the same notification
4. increment/record retry state
5. publish to the correct RabbitMQ queue
6. update status
7. release the claim
8. record an audit event

Use database locking or an atomic state transition appropriate to the existing database.

Do not rely on in-memory locks in a horizontally scaled application.

---

# 20. SCHEDULER SAFETY

The scheduler must be safe if there are multiple application instances.

Do not allow:

```text
Instance A -> picks notification 123
Instance B -> picks notification 123
```

at the same time.

Use one of the existing project's supported approaches:

- database row locking
- atomic update/claim
- advisory lock
- distributed lock

Prefer the simplest approach that matches the existing database.

---

# 21. SMS PROVIDER — SPARROW SMS

Create a provider abstraction.

Do NOT couple the whole notification subsystem directly to Sparrow SMS.

Use:

```text
SmsProvider
     |
     +-- SparrowSmsProvider
     +-- FutureProvider
```

The SMS service should depend on the interface, not directly on HTTP details.

---

# 22. SPARROW SMS OUTGOING/PUSH/MOBILE TERMINATED

Sparrow SMS endpoint:

```text
POST/GET /sms/
```

Current configured base URL is supplied through environment configuration.

Mandatory provider parameters:

```text
token
from
to
text
```

Request concept:

```text
token = environment configuration
from  = configured SMS sender
to    = recipient phone number(s)
text  = message
```

Example provider call:

```bash
curl -s <SMS_BASE_URL> \
  -F token='<configured token>' \
  -F from='<configured sender>' \
  -F to='<recipient>' \
  -F text='<message>'
```

Do not hardcode any values.

---

# 23. SPARROW SMS RESPONSE HANDLING

Successful response:

```json
{
  "count": 1,
  "response_code": 200,
  "response": "1 message has been queued for delivery"
}
```

Treat this carefully.

A response such as:

```text
response_code = 200
```

means the provider accepted/queued the SMS request.

It does NOT necessarily prove the recipient handset received the SMS.

Therefore:

```text
provider accepted
```

should map to something such as:

```text
SENT / ACCEPTED
```

not:

```text
DELIVERED
```

Only mark:

```text
DELIVERED
```

when the provider supplies actual delivery confirmation.

If Sparrow SMS does not provide an outbound delivery callback/API in the currently available API contract, document that limitation rather than falsely claiming delivery.

---

# 24. SPARROW SMS ERROR CODES

Handle provider error codes explicitly.

Known errors include:

```text
1000 Required field missing
1001 Invalid IP Address
1002 Invalid Token
1003 Account Inactive
1004 Account Inactive
1005 Account Expired
1006 Account Expired
1007 Invalid Receiver
1008 Invalid Sender
1010 Text cannot be empty
1011 No valid receiver
1012 No Credits Available
1013 Insufficient Credits
```

Classify them.

Examples:

### Permanent

```text
1007 Invalid Receiver
1008 Invalid Sender
1010 Text cannot be empty
1011 No valid receiver
```

### Configuration/account problems

```text
1001 Invalid IP
1002 Invalid Token
1003/1004 Account Inactive
1005/1006 Account Expired
```

These should not be blindly retried repeatedly.

### Credit-related

```text
1012 No Credits Available
1013 Insufficient Credits
```

Treat as a provider/account capacity problem.

Do not burn retries while the account has no credits.

Make classification configurable so provider behavior can evolve.

---

# 25. SPARROW CREDIT API

Sparrow exposes:

```text
GET /credit/
```

with:

```text
token
```

and a response conceptually:

```json
{
  "credits_available": 10,
  "credits_consumed": 5,
  "response_code": 200
}
```

Create a provider method such as:

```text
getCredits()
```

but do NOT continuously poll it unless required.

Avoid wasting provider API calls.

This can later be used for:

- admin diagnostics
- health checks
- operational monitoring
- low-credit alerts

Do not expose the provider token through an API response.

---

# 26. SMS PULL / INCOMING SMS

The system should have an architectural foundation for incoming SMS.

Sparrow SMS sends a GET request to the configured public callback URL with:

```text
from
to
keyword
text
```

Example:

```text
GET /api/notifications/sms/incoming
```

with query parameters:

```text
from=...
to=...
keyword=...
text=...
```

Do not blindly expose this endpoint without security controls.

Because the provider contract described here does not provide a cryptographic signature mechanism, investigate what verification mechanisms Sparrow supports in the current account/API.

Possible controls may include:

- allowlisted provider IPs if officially documented and stable
- HTTPS
- route-specific authentication where supported
- rate limiting
- request validation
- maximum payload size
- replay protection where possible
- logging/monitoring
- keyword validation
- shortcode validation

Do not invent unsupported provider security mechanisms.

---

# 27. INCOMING SMS PERSISTENCE

Create an incoming SMS table.

Conceptually:

```text
incoming_sms

id

provider
provider_message_id (if available)

from_number
to_shortcode
keyword
text

received_at

processing_status
processed_at

reply_text
reply_status

raw_payload_reference
created_at
updated_at
```

Do not store unnecessary sensitive information.

The raw incoming message should only be retained according to the application's privacy/data-retention requirements.

---

# 28. INCOMING SMS PROCESSING

Incoming SMS processing should be separated from the HTTP webhook.

Do not put complex business logic directly inside the provider callback.

Preferred:

```text
Sparrow webhook
      |
      v
Validate request
      |
      v
Persist incoming SMS
      |
      v
Acknowledge provider
      |
      v
Queue processing
      |
      v
Incoming SMS processor
      |
      v
Business action
      |
      v
Optional SMS reply
```

The callback should be fast.

Do not keep the provider HTTP connection open while performing expensive business logic.

---

# 29. INCOMING SMS RESPONSE

Sparrow expects the callback URL to process the request and return a text response of at most 160 characters with HTTP 200 or 202.

If the endpoint returns another status, Sparrow may send its configured default reply.

Therefore:

- validate quickly
- persist the message
- acknowledge safely
- return a short valid response
- process complex logic asynchronously

Do not return arbitrary long application error messages.

---

# 30. EMAIL SERVICE

Create an email provider abstraction.

Conceptually:

```text
EmailProvider
     |
     +-- SmtpEmailProvider
     +-- FutureEmailProvider
```

The current implementation should use SMTP configuration supplied through environment variables.

Current infrastructure is SMTP relay based.

Configuration includes:

```text
host
port
username
password
SMTP auth
STARTTLS
```

Never hardcode these values.

---

# 31. EMAIL SERVICE RESPONSIBILITIES

The email service should handle:

- connection/configuration
- sender configuration
- recipient validation
- subject
- plain text body
- HTML body if supported by existing requirements
- attachments only if explicitly required
- provider response
- timeout handling
- error classification
- notification attempt persistence

Do not mix SMTP implementation with notification orchestration.

---

# 32. EMAIL DELIVERY SEMANTICS

SMTP success generally means the SMTP server accepted the message for processing.

It does NOT guarantee:

- recipient inbox delivery
- inbox placement
- user opened the email

Therefore distinguish:

```text
SMTP_ACCEPTED
```

from:

```text
DELIVERED
```

and:

```text
OPENED
```

if provider events become available.

For the current SMTP implementation, do not falsely mark email as `DELIVERED` merely because SMTP accepted the message.

---

# 33. EMAIL DELIVERY EVENTS

The architecture must support provider delivery events later.

Brevo transactional email systems can provide events such as:

```text
sent
delivered
opened
clicked
soft bounce
hard bounce
blocked
spam
invalid
deferred
```

The notification model should therefore have room for asynchronous provider status updates.

When provider webhooks/events are integrated:

```text
Brevo event
    |
    v
Webhook endpoint
    |
    v
Validate/authenticate
    |
    v
Deduplicate event
    |
    v
Map provider event
    |
    v
notification_events
    |
    v
notifications.status
```

Do not assume event ordering.

Provider webhooks can arrive out of order.

Use event timestamps/status precedence where necessary.

---

# 34. PROVIDER MESSAGE ID MAPPING

Always persist provider identifiers returned by the provider.

Example:

```text
notification.id
        |
        +-- provider = brevo
        |
        +-- provider_message_id = ...
```

This mapping is essential for reconciliation.

The system should be able to answer:

```text
Which internal notification produced provider message X?
```

This is a standard production requirement.

---

# 35. NOTIFICATION EVENT HISTORY

Do not only store the current status.

Maintain a history.

Example:

```text
Notification #123

PENDING
2026-09-26 10:00

QUEUED
2026-09-26 10:00:01

PROCESSING
2026-09-26 10:00:02

SENT
2026-09-26 10:00:03
provider_message_id = XYZ

DELIVERED
2026-09-26 10:00:08
```

Or:

```text
PENDING
  ↓
QUEUED
  ↓
PROCESSING
  ↓
FAILED
  ↓
RETRYING
  ↓
PROCESSING
  ↓
SENT
```

This gives operations teams a complete audit trail.

---

# 36. RETRY CLASSIFICATION

Build a provider-independent error classification layer.

Conceptually:

```typescript
type FailureCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'CONFIGURATION'
  | 'RATE_LIMIT'
  | 'INSUFFICIENT_CREDIT'
  | 'TIMEOUT'
  | 'UNKNOWN';
```

The exact types should follow the project conventions.

Each provider adapter should return normalized errors.

For example:

```text
Provider-specific error
        |
        v
Normalized NotificationError
        |
        +-- category
        +-- retryable
        +-- providerCode
        +-- providerMessage
```

This prevents RabbitMQ consumers from knowing provider-specific error codes.

---

# 37. TIMEOUTS

Every external provider call must have an explicit timeout.

Do not allow:

```text
HTTP request hangs indefinitely
```

or:

```text
SMTP connection hangs indefinitely
```

Configure:

- connection timeout
- request timeout
- socket timeout where applicable

Use sane configurable defaults.

---

# 38. CIRCUIT BREAKER / PROVIDER PROTECTION

Do not over-engineer the first implementation.

However, design provider adapters so circuit breaking/rate limiting can be introduced later.

If the existing project already has a resilience library, reuse it.

The initial system must at minimum have:

- bounded concurrency
- timeout
- retry classification
- exponential backoff
- jitter
- DLQ
- observability

Do not hammer a failing provider.

---

# 39. RABBITMQ CONNECTION MANAGEMENT

Implement RabbitMQ as a long-lived infrastructure connection.

Do not open a new RabbitMQ connection for every notification.

Support:

- reconnect
- connection failure handling
- channel recreation
- graceful shutdown
- publisher confirms where appropriate
- durable queues/exchanges
- persistent messages

Use the project's existing RabbitMQ library if one exists.

---

# 40. PUBLISHER CONFIRMS

Where supported by the selected RabbitMQ client/library, use publisher confirms.

The system should distinguish:

```text
application attempted publish
```

from:

```text
RabbitMQ confirmed publish
```

Only mark an outbox message as successfully published after the broker confirms it.

---

# 41. CONSUMER ACKNOWLEDGEMENT

Do not acknowledge a RabbitMQ message before successful processing.

Conceptually:

```text
consume
  |
  v
process
  |
  +-- success --> ACK
  |
  +-- retryable failure --> retry/dead-letter strategy
  |
  +-- permanent failure --> DLQ
```

Avoid:

```text
consume
  |
  v
ACK
  |
  v
process
```

because a process crash after ACK loses the notification.

---

# 42. PREFETCH / CONCURRENCY

Configure RabbitMQ consumer prefetch and concurrency.

Do not consume unlimited messages simultaneously.

Make concurrency configurable.

Example conceptual configuration:

```text
SMS_CONSUMER_CONCURRENCY
EMAIL_CONSUMER_CONCURRENCY
RABBITMQ_PREFETCH
```

Tune these later based on provider limits and infrastructure capacity.

---

# 43. RATE LIMITING

Provider rate limits must be respected.

Create provider-specific configuration such as:

```text
SMS_MAX_CONCURRENCY
EMAIL_MAX_CONCURRENCY
SMS_RATE_LIMIT
EMAIL_RATE_LIMIT
```

Do not hardcode provider throughput assumptions.

If the provider returns a rate-limit or temporary capacity error, schedule a retry rather than hammering the provider.

---

# 44. NOTIFICATION TEMPLATES

Do not hardcode large notification messages throughout business services.

Use templates.

Conceptually:

```text
templates/
    email/
        welcome
        otp
        order-created
        order-confirmed
        password-reset

    sms/
        otp
        order-status
        delivery-update
```

The initial implementation does not need every business template.

Create the template architecture without unnecessarily wiring notifications into all business flows.

---

# 45. OTP

There is an existing OTP configuration requirement:

```text
otp:
  expiry-minutes: 5
  length: 6
```

Keep these values in environment/configuration.

If OTP functionality already exists, do not rewrite it.

If future OTP notification integration is needed, OTP generation, persistence, verification, and notification delivery must remain separate concerns.

Never store plaintext OTPs unnecessarily.

Never log OTP values.

---

# 46. SECURITY REQUIREMENTS

The notification subsystem must be secure by default.

### Secrets

Never expose provider credentials.

### Logs

Never log:

- SMS provider token
- SMTP password
- RabbitMQ password
- email password
- message authentication secrets
- OTP
- complete sensitive message contents

Mask:

```text
phone numbers
email addresses
provider IDs
```

where appropriate.

### Webhooks

Validate incoming webhook data.

Protect against:

- replay
- spoofing
- malformed payloads
- oversized requests
- injection
- duplicate events
- brute-force attempts

### Database

Use parameterized queries/ORM safely.

Never concatenate provider payloads into SQL.

### RabbitMQ

Use TLS when configured.

Do not expose RabbitMQ credentials to frontend applications.

---

# 47. LOGGING

Use structured logging.

Every notification-related log should have correlation fields where available:

```text
notificationId
attemptId
provider
channel
eventType
providerMessageId
```

Do not log full message contents by default.

Example:

```json
{
  "event": "notification.send.failed",
  "notificationId": "...",
  "attemptId": "...",
  "channel": "EMAIL",
  "provider": "SMTP",
  "retryable": true
}
```

---

# 48. CORRELATION ID

Support correlation IDs.

When a notification originates from an API/business request, propagate the correlation/request ID where the existing architecture supports it.

This allows tracing:

```text
HTTP request
   |
   v
business operation
   |
   v
notification
   |
   v
RabbitMQ
   |
   v
consumer
   |
   v
provider
```

---

# 49. HEALTH CHECKS

If the project already has health endpoints, add notification infrastructure health indicators without changing the existing health-check contract unnecessarily.

Possible checks:

```text
database
rabbitmq
smtp configuration/connectivity
provider configuration
```

Do not make health checks consume SMS credits.

Do not send a real SMS from a health check.

---

# 50. METRICS

If the application already supports metrics, add:

```text
notifications_created_total
notifications_queued_total
notifications_sent_total
notifications_delivered_total
notifications_failed_total
notifications_dead_lettered_total
notification_retry_total

notification_processing_duration
notification_provider_duration

rabbitmq_queue_depth
notification_dlq_depth
```

Add provider/channel dimensions carefully to avoid high-cardinality metrics.

---

# 51. RECONCILIATION

Production notification systems cannot assume every provider event will arrive.

Therefore create a reconciliation architecture.

Conceptually:

```text
Scheduled reconciliation
        |
        v
Find notifications stuck in:
    SENT / ACCEPTED
        |
        v
Provider lookup when supported
        |
        v
Update local status
```

For providers without a lookup/delivery API, mark the status as:

```text
ACCEPTED / UNKNOWN_DELIVERY
```

rather than inventing delivery success.

This is especially important for SMS.

---

# 52. DELIVERY SEMANTICS

The implementation must clearly distinguish these concepts:

```text
CREATED
```

Notification exists in our database.

```text
QUEUED
```

Notification was submitted to RabbitMQ.

```text
PROCESSING
```

A worker is attempting delivery.

```text
ACCEPTED / SENT
```

External provider accepted the request.

```text
DELIVERED
```

Provider confirmed delivery.

```text
FAILED
```

Delivery attempt failed.

```text
DEAD_LETTERED
```

Notification exhausted retry handling or is awaiting manual intervention.

Never use:

```text
HTTP 200 = delivered
```

as a generic assumption.

---

# 53. DATABASE INDEXES

Add appropriate indexes.

Likely useful indexes include:

```text
status
channel
provider
provider_message_id
next_retry_at
created_at
recipient_phone
recipient_email
```

Do not blindly index every column.

Check existing database conventions and expected query patterns.

---

# 54. DATA RETENTION

Design notification history with retention in mind.

Notification tables can grow rapidly.

Define configuration/documentation for:

- retention period
- cleanup strategy
- archival strategy if needed

Do not implement destructive cleanup without explicit project requirements.

---

# 55. API DESIGN

Do not expose internal notification database records directly.

If notification management APIs are needed, use explicit DTOs.

Potential future APIs:

```text
GET /notifications/:id
GET /notifications
POST /notifications
POST /notifications/:id/retry
```

These should be introduced only if required.

For now, prioritize the infrastructure and service layer rather than creating unnecessary public APIs.

---

# 56. ADMIN OBSERVABILITY

The architecture should make it possible for an admin/operator to later answer:

- How many emails were sent today?
- How many failed?
- Which messages are in DLQ?
- Which notifications are retrying?
- Why did notification #123 fail?
- How many attempts were made?
- Which provider accepted the message?
- What provider message ID was returned?
- Was delivery confirmed?
- How long did delivery take?
- Which recipients have repeated failures?

Do not build a complete admin UI unless explicitly requested.

Build the backend data model so it can support one later.

---

# 57. WORLD-CLASS NOTIFICATION DESIGN PRINCIPLES

Use the following principles observed in mature messaging platforms:

### Durable source of truth

Persist notification state independently of the queue.

### Asynchronous delivery

Do not block business requests on external SMS/email providers unless the existing business requirement explicitly requires synchronous behavior.

### At-least-once processing

Assume duplicate messages can happen.

### Idempotent consumers

Repeated processing should not create uncontrolled duplicate effects.

### Bounded retries

Never retry forever.

### Exponential backoff + jitter

Prevent retry storms.

### Dead-lettering

Isolate messages that cannot currently be processed.

### Provider acknowledgements

Track provider acceptance separately from actual delivery.

### Webhooks/events

Use provider delivery events when available.

### Reconciliation

Periodically repair missing provider events/statuses when provider APIs allow it.

### Audit trail

Keep notification attempts/events.

### Provider abstraction

Avoid vendor lock-in.

### Explicit contracts

Use DTOs/interfaces rather than returning provider objects or database entities.

### Observability

Track latency, failures, queue depth, retries, and delivery outcomes.

---

# 58. IMPORTANT DISTINCTION: QUEUE RELIABILITY VS DELIVERY RELIABILITY

RabbitMQ can make the application-to-worker path reliable.

It cannot guarantee that a recipient received an SMS/email.

The full path is:

```text
Application
    ↓
Database
    ↓
Outbox
    ↓
RabbitMQ
    ↓
Worker
    ↓
Provider
    ↓
Carrier / Mail Server
    ↓
Recipient
```

Each boundary has different reliability semantics.

The database tells us the notification exists.

RabbitMQ tells us the message was transported to a consumer.

The provider tells us whether it accepted the send request.

Provider delivery events may tell us whether the destination system received it.

Only the provider/carrier/mail system can provide delivery evidence.

Do not represent these states as one boolean.

---

# 59. TASK EXECUTION MODEL

Implement this project as multiple independent tasks.

Every task must follow an iteration model.

For every task:

```text
1. Analyze
2. Plan
3. Implement
4. Test
5. Review
6. Fix
7. Verify
8. Mark checklist complete
9. Stop
```

Do not silently skip steps.

After completing a task, inspect the changes for unintended effects before starting the next task.

---

# TASK 0 — FULL PROJECT DISCOVERY

## Objective

Understand the existing system before coding.

### Checklist

- [ ] Inspect repository structure
- [ ] Identify backend framework
- [ ] Identify frontend framework
- [ ] Identify Node.js/TypeScript versions
- [ ] Identify package manager
- [ ] Identify database
- [ ] Identify ORM/query builder
- [ ] Identify migrations
- [ ] Identify configuration system
- [ ] Identify scheduler
- [ ] Identify RabbitMQ/queue infrastructure
- [ ] Identify existing email functionality
- [ ] Identify existing SMS functionality
- [ ] Identify logging
- [ ] Identify error handling
- [ ] Identify testing
- [ ] Identify Docker/deployment
- [ ] Identify health checks
- [ ] Identify existing notification-related code
- [ ] Identify files/modules that must remain untouched
- [ ] Document architectural findings
- [ ] Do NOT modify application code

### Completion condition

Do not proceed until the architecture is understood.

---

# TASK 1 — NOTIFICATION ARCHITECTURE DESIGN

## Objective

Design the notification subsystem around the existing project.

### Checklist

- [ ] Define module boundaries
- [ ] Define notification lifecycle
- [ ] Define status model
- [ ] Define provider abstraction
- [ ] Define database entities
- [ ] Define RabbitMQ topology
- [ ] Define retry strategy
- [ ] Define DLX/DLQ strategy
- [ ] Define scheduler strategy
- [ ] Define idempotency strategy
- [ ] Define webhook strategy
- [ ] Define observability
- [ ] Define security model
- [ ] Define configuration model
- [ ] Confirm no unrelated modules need refactoring

### Completion condition

Architecture is documented before implementation.

---

# TASK 2 — CONFIGURATION FOUNDATION

### Checklist

- [ ] Add notification environment variables
- [ ] Add SMS configuration
- [ ] Add RabbitMQ configuration
- [ ] Add SMTP configuration
- [ ] Add retry configuration
- [ ] Add scheduler configuration
- [ ] Add `.env.example` placeholders
- [ ] Validate required configuration at startup
- [ ] Never expose secrets in logs
- [ ] Verify existing configuration remains compatible

---

# TASK 3 — DATABASE FOUNDATION

### Checklist

- [ ] Create notifications table/entity
- [ ] Create notification attempts table/entity
- [ ] Create notification events table/entity if appropriate
- [ ] Create incoming SMS table/entity
- [ ] Add indexes
- [ ] Add migration
- [ ] Follow existing migration conventions
- [ ] Add repository layer
- [ ] Test migration
- [ ] Verify rollback if project supports rollback
- [ ] Verify no existing table is modified unnecessarily

---

# TASK 4 — NOTIFICATION CORE SERVICE

### Checklist

- [ ] Implement notification domain model
- [ ] Implement notification service
- [ ] Implement status transitions
- [ ] Implement validation
- [ ] Implement idempotency
- [ ] Implement persistence
- [ ] Implement attempt recording
- [ ] Implement event recording
- [ ] Add unit tests
- [ ] Verify no provider-specific code leaks into the core service

---

# TASK 5 — RABBITMQ INFRASTRUCTURE

### Checklist

- [ ] Implement RabbitMQ connection
- [ ] Implement reconnect behavior
- [ ] Create durable exchanges
- [ ] Create durable queues
- [ ] Create routing keys
- [ ] Create DLX
- [ ] Create DLQs
- [ ] Configure persistent messages
- [ ] Configure acknowledgements
- [ ] Configure publisher confirms
- [ ] Configure prefetch
- [ ] Configure consumer concurrency
- [ ] Implement graceful shutdown
- [ ] Add integration tests where possible

---

# TASK 6 — OUTBOX/PUBLISHING

### Checklist

- [ ] Implement outbox if appropriate for existing DB architecture
- [ ] Implement outbox publisher
- [ ] Use publisher confirmation
- [ ] Mark outbox events published only after broker confirmation
- [ ] Handle duplicate publication safely
- [ ] Add retry for broker publication
- [ ] Add tests for application crash scenarios conceptually
- [ ] Verify business transactions remain unaffected

---

# TASK 7 — EMAIL PROVIDER

### Checklist

- [ ] Create EmailProvider interface
- [ ] Implement SMTP provider
- [ ] Read all SMTP configuration from environment
- [ ] Configure STARTTLS
- [ ] Configure authentication
- [ ] Add timeout
- [ ] Normalize provider errors
- [ ] Persist provider response/message ID when available
- [ ] Record attempts
- [ ] Do NOT mark SMTP acceptance as delivery
- [ ] Add unit tests
- [ ] Add safe integration test if appropriate

---

# TASK 8 — SMS PROVIDER

### Checklist

- [ ] Create SmsProvider interface
- [ ] Implement SparrowSmsProvider
- [ ] Read token from environment
- [ ] Read sender from environment
- [ ] Read base URL from environment
- [ ] Implement POST/GET provider call according to provider requirements
- [ ] Normalize provider responses
- [ ] Map provider error codes
- [ ] Implement timeout
- [ ] Implement retry classification
- [ ] Implement credit lookup method
- [ ] Do NOT automatically consume SMS credits through business flows
- [ ] Add unit tests using mocks
- [ ] Do not hardcode provider credentials

---

# TASK 9 — NOTIFICATION WORKERS

### Checklist

- [ ] Implement email consumer
- [ ] Implement SMS consumer
- [ ] Implement processing lock/idempotency
- [ ] Implement provider invocation
- [ ] Persist attempts
- [ ] Update notification status
- [ ] ACK successful processing
- [ ] Route retryable failures appropriately
- [ ] Route permanent/max-retry failures to DLQ
- [ ] Prevent duplicate side effects
- [ ] Add consumer tests

---

# TASK 10 — RETRY/DLQ PROCESSING

### Checklist

- [ ] Define retry categories
- [ ] Define maximum attempts
- [ ] Implement exponential backoff
- [ ] Implement jitter
- [ ] Implement `next_retry_at`
- [ ] Implement DLQ handling
- [ ] Prevent infinite loops
- [ ] Prevent retry storms
- [ ] Prevent permanent errors from retrying indefinitely
- [ ] Record every retry attempt
- [ ] Test retry behavior

---

# TASK 11 — RETRY SCHEDULER

### Checklist

- [ ] Inspect existing scheduler
- [ ] Reuse existing scheduler if available
- [ ] Implement scheduled retry scan
- [ ] Find eligible notifications
- [ ] Safely claim notifications
- [ ] Prevent multi-instance duplicate processing
- [ ] Publish eligible notifications to RabbitMQ
- [ ] Update retry state
- [ ] Record events
- [ ] Use bounded random jitter
- [ ] Add scheduler metrics/logging
- [ ] Test concurrent scheduler execution

---

# TASK 12 — INCOMING SMS FOUNDATION

### Checklist

- [ ] Create public incoming SMS endpoint
- [ ] Validate query parameters
- [ ] Validate payload size
- [ ] Implement provider verification strategy
- [ ] Rate limit endpoint
- [ ] Persist incoming SMS
- [ ] Deduplicate where possible
- [ ] Return provider-compatible response
- [ ] Keep response under 160 characters
- [ ] Queue complex processing
- [ ] Do not perform heavy business logic in webhook
- [ ] Add security tests
- [ ] Add duplicate/replay tests

---

# TASK 13 — WEBHOOK/EVENT FOUNDATION

### Checklist

- [ ] Create provider event abstraction
- [ ] Create webhook security layer
- [ ] Validate provider events
- [ ] Deduplicate provider events
- [ ] Persist event
- [ ] Map provider status
- [ ] Handle out-of-order events
- [ ] Update notification status safely
- [ ] Add webhook tests

Do not implement unsupported Sparrow delivery callbacks.

Do not invent provider capabilities.

---

# TASK 14 — OBSERVABILITY

### Checklist

- [ ] Add structured logs
- [ ] Add correlation IDs
- [ ] Add notification IDs to logs
- [ ] Add attempt IDs to logs
- [ ] Add provider IDs to logs where safe
- [ ] Add queue metrics if existing system supports metrics
- [ ] Add DLQ depth monitoring if feasible
- [ ] Add notification success/failure metrics
- [ ] Add retry metrics
- [ ] Avoid high-cardinality metrics
- [ ] Mask sensitive information

---

# TASK 15 — TESTING

Implement tests at multiple levels.

### Unit

- [ ] notification service
- [ ] status transitions
- [ ] retry classifier
- [ ] backoff
- [ ] jitter
- [ ] Sparrow response mapper
- [ ] SMTP error mapper
- [ ] idempotency logic

### Integration

- [ ] database
- [ ] RabbitMQ
- [ ] provider adapters with mocks/test servers
- [ ] consumer processing
- [ ] DLQ behavior

### Failure tests

Simulate:

- [ ] provider timeout
- [ ] provider 500
- [ ] provider 400
- [ ] invalid recipient
- [ ] no SMS credits
- [ ] invalid provider credentials
- [ ] RabbitMQ unavailable
- [ ] database unavailable
- [ ] duplicate RabbitMQ message
- [ ] duplicate webhook
- [ ] scheduler concurrency
- [ ] application crash during processing

### Security

- [ ] secrets not returned
- [ ] secrets not logged
- [ ] webhook validation
- [ ] payload validation
- [ ] rate limiting
- [ ] authorization where required

---

# TASK 16 — FINAL ARCHITECTURE REVIEW

Before declaring completion:

### Checklist

- [ ] Review all changed files
- [ ] Review all database migrations
- [ ] Review environment configuration
- [ ] Review RabbitMQ topology
- [ ] Review retry logic
- [ ] Review DLQ/DLX logic
- [ ] Review scheduler
- [ ] Review provider abstractions
- [ ] Review security
- [ ] Review logs
- [ ] Review tests
- [ ] Verify no SMS is accidentally sent by unrelated business flows
- [ ] Verify no existing feature was changed
- [ ] Verify no credentials are hardcoded
- [ ] Verify no sensitive values are logged
- [ ] Verify TypeScript compilation
- [ ] Verify lint
- [ ] Verify tests
- [ ] Verify migration
- [ ] Verify application startup
- [ ] Verify graceful shutdown

---

# 60. FINAL ACCEPTANCE CRITERIA

The implementation is accepted only when:

## Architecture

- [ ] Notification subsystem is isolated
- [ ] SMS and email are separate modules
- [ ] RabbitMQ infrastructure is isolated
- [ ] Provider adapters are replaceable
- [ ] Existing project architecture is respected

## Persistence

- [ ] Notification records are durable
- [ ] Attempts are stored
- [ ] Events/history are stored
- [ ] Provider message IDs are stored
- [ ] Failure reasons are stored
- [ ] Retry state is stored

## RabbitMQ

- [ ] Durable queues
- [ ] Durable exchanges
- [ ] Persistent messages
- [ ] Explicit ACK
- [ ] Publisher confirms
- [ ] DLX
- [ ] DLQ
- [ ] Retry strategy
- [ ] No infinite retry loop

## Email

- [ ] SMTP integration
- [ ] Environment-based configuration
- [ ] Timeouts
- [ ] Error classification
- [ ] Provider acceptance separated from delivery

## SMS

- [ ] Sparrow provider abstraction
- [ ] Environment-based credentials
- [ ] No hardcoded secrets
- [ ] Provider response mapping
- [ ] Error-code mapping
- [ ] Credit lookup
- [ ] No automatic SMS consumption during initial integration

## Incoming SMS

- [ ] Secure webhook
- [ ] Persistence
- [ ] Validation
- [ ] Deduplication
- [ ] Asynchronous processing
- [ ] Provider-compatible response

## Reliability

- [ ] At-least-once processing
- [ ] Idempotent consumers
- [ ] Bounded retries
- [ ] Exponential backoff
- [ ] Jitter
- [ ] DLQ
- [ ] Scheduled retry
- [ ] Multi-instance-safe scheduler

## Security

- [ ] No secrets in source code
- [ ] No secrets in Git
- [ ] No secrets in logs
- [ ] No secrets in API responses
- [ ] Webhooks protected
- [ ] Input validated
- [ ] Provider credentials server-side only

## Compatibility

- [ ] Existing authentication unchanged
- [ ] Existing authorization unchanged
- [ ] Existing business flows unchanged
- [ ] Existing APIs unchanged unless explicitly required
- [ ] Existing database tables untouched unless required
- [ ] Existing tests continue passing

---

# 61. HOW TO REPORT EACH ITERATION

At the end of every task, report:

```text
Task: TASK-X

Status:
COMPLETED / BLOCKED

Changes:
- ...

Files added:
- ...

Files modified:
- ...

Database:
- ...

RabbitMQ:
- ...

Tests:
- ...

Security:
- ...

Regression:
- ...

Checklist:
[x] Item
[x] Item
[ ] Item

Remaining:
- ...

Next task:
TASK-X+1
```

Do not claim completion if any required checklist item is incomplete.

---

# 62. IMPORTANT DEVELOPMENT BEHAVIOR

Work like a senior production engineer.

Before every change ask:

1. Is this necessary?
2. Does the existing project already solve this?
3. Will this break an existing feature?
4. Is this change backward compatible?
5. Is this secure?
6. Is this observable?
7. Is this retry-safe?
8. Is this idempotent?
9. What happens if the process crashes here?
10. What happens if RabbitMQ is unavailable?
11. What happens if the provider is unavailable?
12. What happens if the provider accepted the message but our process crashed?
13. What happens if the same message is delivered twice?
14. What happens if webhooks arrive out of order?
15. What happens if two application instances run the scheduler?
16. What happens if the database transaction succeeds but message publication fails?

Do not optimize for the shortest implementation.

Optimize for:

```text
correctness
security
reliability
maintainability
observability
operational simplicity
backward compatibility
```

---

# 63. DO NOT CLAIM IMPOSSIBLE GUARANTEES

Do not claim:

```text
100% delivery
exactly-once delivery
zero duplicate messages
guaranteed recipient receipt
```

Instead document the actual guarantees:

```text
durable persistence
at-least-once processing
idempotent consumers
bounded retries
dead-letter handling
provider acceptance tracking
delivery confirmation where provider supports it
reconciliation where provider supports it
```

This distinction is critical for a production notification system.

---

# 64. RESEARCH BASIS / ENGINEERING REFERENCES

Use these concepts as architectural guidance, not as instructions to copy another company's implementation.

### Transactional Outbox

The transactional outbox pattern stores an outgoing message in the database in the same transaction as the business change, then a separate relay publishes it. It addresses the failure window between committing a database transaction and publishing to a broker. Consumers still need idempotency because the relay can publish more than once.

Reference:

https://microservices.io/patterns/data/transactional-outbox

### RabbitMQ Dead Lettering and TTL

RabbitMQ supports dead-letter exchanges and message/queue TTLs. Use DLX/DLQ deliberately rather than creating uncontrolled requeue loops.

References:

https://www.rabbitmq.com/docs/dlx

https://www.rabbitmq.com/docs/ttl

### Mature messaging delivery tracking

Production messaging systems distinguish message acceptance from actual delivery and track asynchronous status changes using provider callbacks/events where available.

Twilio's messaging documentation is a useful example of this model:

https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks

https://www.twilio.com/docs/messaging/guides/outbound-message-logging

https://www.twilio.com/docs/messaging/guides/track-outbound-message-status

### Email event tracking

Transactional email providers commonly expose events such as sent, delivered, bounce, complaint, deferred/delivery-delay, and other lifecycle events.

Brevo:

https://developers.brevo.com/docs/how-to-use-webhooks

Amazon SES:

https://docs.aws.amazon.com/ses/latest/dg/monitor-using-event-publishing.html

https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html

Use these references to understand industry patterns. Do not assume the current providers expose identical APIs.

---

# 65. FINAL INSTRUCTION TO THE CODING AGENT

Do not start coding until you have analyzed the entire project.

Do not modify unrelated features.

Do not hardcode the credentials supplied for RabbitMQ, SMTP, or Sparrow SMS.

Do not automatically send SMS during initial integration.

Build the notification subsystem as a clean, modular, production-grade subsystem.

Use separate modules for:

```text
notification
sms
email
queue
scheduler
webhook
persistence
templates
```

Use:

```text
database
+
transactional outbox where appropriate
+
RabbitMQ
+
DLX/DLQ
+
bounded retry
+
exponential backoff
+
jitter
+
idempotency
+
provider status tracking
+
reconciliation
```

Treat the database as the source of truth for notification state.

Treat RabbitMQ as the transport mechanism.

Treat provider responses as external delivery evidence.

Treat provider webhooks/events as asynchronous status evidence.

Never confuse:

```text
queued
```

with:

```text
sent
```

or:

```text
sent
```

with:

```text
delivered
```

Complete the work iteratively, using the task checklists above.

After every task, verify that existing Clothing Store functionality still behaves exactly as before.

The result should be maintainable by another senior developer without needing to understand unrelated parts of the application.
