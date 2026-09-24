# SECURITY.md

Purpose
- Document security posture, authentication & authorization, secrets management, encryption standards, and common vulnerability mitigations for maintainers and automated agents.

1. Authentication & Authorization
- Authentication:
  - JWT-based authentication: server signs tokens using JWT_SECRET. Tokens returned on login/register flows.
  - Passwords: stored using bcrypt hashes (bcryptjs/bcrypt). Minimum length enforced at registration (>=8).
  - Client-side: passwords are AES-encrypted in transit and sent as { encryptedPassword, iv } — server decrypts using AES_SECRET_KEY (decryptAES utility). This is an additional layer on top of TLS but should not replace TLS.
- Authorization:
  - Role-based: admin JWT contains { role: "admin" } used by authAdmin middleware. User endpoints validated against token userId where needed.
  - Principle of least privilege: admin routes protected by middleware; enforce server-side checks on all operations (e.g., product creation, stock adjustments, financial endpoints).

2. Transport and Encryption
- Use TLS (HTTPS) for all production traffic. Ensure load balancer or CDN terminates TLS with strong ciphers.
- At-rest:
  - Secrets (JWT_SECRET, AES_SECRET_KEY, DB credentials, payment keys) must be stored in environment variables and secret stores (e.g., Vault, AWS Secrets Manager, Railway/Heroku secret configs). Do NOT commit secrets to repo.
  - Database: enable encryption-at-rest provided by cloud DB service.
- In-transit:
  - Enforce HTTPS and HSTS. APIs must reject non-secure requests in production.

3. Secrets management
- .env files: .env.example exists; real .env must be gitignored. Rotate secrets regularly.
- Recommend using a secrets manager for production. CI/CD pipelines should inject secrets via secured environment variables.
- Limit access to production secrets using IAM and audit logs.

4. Common web vulnerability mitigations & Injection Attack Defenses
- SQL Injection (SQLi):
  - ORM Layer: Prisma is canonical and generates parameterized queries. Avoid constructing raw SQL queries (`$queryRawUnsafe`, `$executeRawUnsafe`).
  - Text Field Sanitization: Input strings are checked and cleansed of SQL injection control metacharacters (`--`, `/* */`, `UNION SELECT`, `' OR '1'='1`) before persistence.
- NoSQL & Object / Parameter Injection:
  - Backend parameters (`req.body`, `req.query`, `req.params`) are strictly type-checked.
  - Object injection is prevented by validating primitive data types (string, number, boolean) before querying database records.
- Cross-Site Scripting (XSS):
  - Global backend sanitization middleware (`backend/middleware/sanitize.js`) automatically scrubs dangerous HTML `<script>`, `<iframe>`, `<object>`, `<embed>`, inline event handlers (`onload=`, `onerror=`), and `javascript:` URIs across all incoming JSON and URL payloads.
  - Client panels (`frontend/`, `admin/`, `manufacturer/`) implement client-side input cleaning via their respective `utils/sanitize.js` before network transmission as defense-in-depth.
- Prototype Pollution:
  - Deep recursive object sanitizers automatically drop `__proto__`, `constructor`, and `prototype` keys from all JSON payloads before processing.
- Null-Byte Injection:
  - Null bytes (`\0`, `%00`) are stripped from all incoming strings to prevent binary/string truncation vulnerabilities in backend file paths, database strings, and external integrations.
- File upload safety:
  - Validate file types and sizes before uploading to Cloudinary. Use server-side checks for MIME type and size limits.
- Authentication protections:
  - Enforce account lockout or rate-limited retries for repeated failed logins.
  - Use strong JWT secret and consider short-lived access tokens + refresh tokens pattern for higher security.

5. Data privacy and compliance
- Personal data: email, phone, addresses are stored. Treat these as PII and follow applicable laws (GDPR, local data protection laws).
- Admin social-order verification: phone-only lookup returns no social code. The backend must verify the submitted phone and customer-provided code together before linking an order to an account. Invalid-code orders use a unique anonymous order identity and cannot contribute to loyalty, gifts, letters, or rewards.
- Social codes are customer secrets for identity verification. They must not be logged, placed in phone lookup responses, or exposed in unauthenticated endpoints.
- Data retention: define retention policies for logs, orders, and audit trails. Provide endpoints for data deletion if subject to GDPR "right to be forgotten" (not implemented by default).
- Payment data: never store raw payment credentials. Use payment provider tokens (Stripe/Razorpay). Follow PCI-DSS guidance and rely on payment processor for PCI compliance.

6. Operational security
- Logging: avoid logging secrets (tokens, passwords). Use redaction in logs.
- Monitoring & alerting: add alerts for spikes in failed logins, sudden changes in ledger balances, or repeated 500 errors.
- Backups: implement regular DB backups and test restore procedures.

7. Mandatory Rules for AI Models & Developer Agents
- **Never bypass sanitization middleware**: Always ensure `sanitizeMiddleware` in `backend/middleware/sanitize.js` is mounted globally in `backend/server.js`.
- **Enforce Dual Validation (Client + Server)**:
  - On frontend/admin/manufacturer panels: clean text fields using `utils/sanitize.js` before sending API requests.
  - On backend controllers: never trust client input. Sanitize free-text fields and assert strict data types (`typeof val === "string"`, `validator.isEmail()`, etc.).
- **Maintain safe rendering**: Never use `dangerouslySetInnerHTML` with raw user input.
- **Run automated security tests**: Run `node --test tests/injectionProtection.test.js` after modifying controllers or middleware to verify zero security regressions.

8. Recommended hardening
- Use Content Security Policy (CSP) headers to reduce XSS risk.
- Set secure cookie attributes: HttpOnly, Secure, SameSite=Strict for auth cookies.
- Use helmet middleware for common security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- Enforce TLS 1.2+ and strong cipher suites.

9. Incident response
- Maintain an incident response playbook for data breaches: contain, assess, notify, remediate, and audit.
- Rotate compromised secrets immediately and invalidate active sessions (rotate JWT secret or maintain a token revocation list).

-- End of SECURITY.md --
