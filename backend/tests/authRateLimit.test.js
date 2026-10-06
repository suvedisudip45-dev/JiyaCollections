import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthRateLimiters,
  loadAuthRateLimitConfig,
  loginRateLimit,
  loginRateLimitForPortal,
  publicRegistrationRateLimit,
  resetLoginRateLimitOnSuccess,
} from "../middleware/authRateLimit.js";
import authRouter from "../routes/authRoute.js";
import manufacturerRouter from "../routes/manufacturerRoute.js";
import marketingCardRouter from "../routes/marketingCardRoute.js";
import userRouter from "../routes/userRoute.js";

const createResponse = () => {
  const result = { headers: {}, statusCode: 200, body: null };
  const response = {
    result,
    set: (name, value) => { result.headers[name] = value; },
    status: (code) => {
      result.statusCode = code;
      return { json: (body) => { result.body = body; return body; } };
    },
    json: (body) => { result.body = body; return body; },
  };
  return response;
};

const invoke = (middleware, req) => {
  const response = createResponse();
  let nextValue;
  middleware(req, response, (value) => { nextValue = value; });
  return { ...response.result, nextValue, response };
};

const request = ({ email = "", ip = "203.0.113.10", headers = {} } = {}) => ({
  body: email ? { email } : {},
  ip,
  headers,
});
const createTestLimiters = (options) => createAuthRateLimiters({
  auditRecorder: async () => {},
  ...options,
});

test("login rate limit applies independent username and IP buckets", () => {
  let currentTime = 1_000;
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 2,
    loginIpBucketSize: 2,
    publicRegisterIpBucketSize: 2,
    now: () => currentTime,
  });

  assert.equal(invoke(limiter.login, request({ email: "Partner@example.test", ip: "ip-one" })).nextValue, undefined);
  assert.equal(invoke(limiter.login, request({ email: "partner@example.test", ip: "ip-two" })).nextValue, undefined);
  const usernameLimited = invoke(limiter.login, request({ email: "PARTNER@example.test", ip: "ip-three" }));
  assert.equal(usernameLimited.statusCode, 429);
  assert.equal(usernameLimited.body.code, "LOGIN_RATE_LIMITED");
  assert.equal(usernameLimited.headers["Retry-After"], "60");

  assert.equal(invoke(limiter.login, request({ email: "another@example.test", ip: "same-ip" })).nextValue, undefined);
  assert.equal(invoke(limiter.login, request({ email: "third@example.test", ip: "same-ip" })).nextValue, undefined);
  const ipLimited = invoke(limiter.login, request({ email: "fourth@example.test", ip: "same-ip" }));
  assert.equal(ipLimited.statusCode, 429);
  assert.equal(ipLimited.body.code, "LOGIN_RATE_LIMITED");

  currentTime += 60_001;
  assert.equal(invoke(limiter.login, request({ email: "partner@example.test", ip: "ip-one" })).nextValue, undefined);
});

test("public registration rate limit uses IP only", () => {
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 5,
    loginIpBucketSize: 30,
    publicRegisterIpBucketSize: 2,
    now: () => 10_000,
  });

  assert.equal(invoke(limiter.publicRegistration, request({ email: "one@example.test" })).nextValue, undefined);
  assert.equal(invoke(limiter.publicRegistration, request({ email: "two@example.test" })).nextValue, undefined);
  const blocked = invoke(limiter.publicRegistration, request({ email: "three@example.test" }));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, "PUBLIC_REGISTRATION_RATE_LIMITED");
  assert.equal(invoke(limiter.publicRegistration, request({ email: "one@example.test", ip: "203.0.113.11" })).nextValue, undefined);
});

test("rate-limit denials enqueue a deduplicated security event without recording login identifiers", () => {
  const auditEvents = [];
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 1,
    loginIpBucketSize: 30,
    publicRegisterIpBucketSize: 2,
    now: () => 10_000,
    auditRecorder: async (actor, event) => auditEvents.push({ actor, event }),
  });
  const req = request({ email: "target@example.test", ip: "203.0.113.10" });
  req.body.targetPortal = "ADMIN";
  invoke(limiter.login, req);
  invoke(limiter.login, req);
  invoke(limiter.login, req);

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].event.action, "LOGIN_RATE_LIMITED");
  assert.equal(auditEvents[0].event.entityType, "SecurityEvent");
  assert.equal(auditEvents[0].event.status, "BLOCKED");
  assert.equal(auditEvents[0].actor.portalSource, "ADMIN");
  assert.equal(JSON.stringify(auditEvents[0]).includes("target@example.test"), false);
});

test("authenticated Manufacturer registration skips the public route limiter", () => {
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 5,
    loginIpBucketSize: 30,
    publicRegisterIpBucketSize: 1,
    now: () => 10_000,
  });

  const adminRequest = request({ headers: { token: "admin-access-token" } });
  assert.equal(invoke(limiter.publicRegistration, adminRequest).nextValue, "route");
  assert.equal(invoke(limiter.publicRegistration, request()).nextValue, undefined);
  assert.equal(invoke(limiter.publicRegistration, request()).statusCode, 429);
});

test("rate-limit bucket size and window load from environment values", () => {
  assert.deepEqual(loadAuthRateLimitConfig({
    AUTH_RATE_LIMIT_WINDOW_MS: "120000",
    AUTH_LOGIN_USERNAME_BUCKET_SIZE: "4",
    AUTH_LOGIN_IP_BUCKET_SIZE: "25",
    AUTH_PUBLIC_REGISTER_IP_BUCKET_SIZE: "3",
  }), {
    windowMs: 120_000,
    loginUsernameBucketSize: 4,
    loginIpBucketSize: 25,
    publicRegisterIpBucketSize: 3,
  });
  assert.throws(() => loadAuthRateLimitConfig({ AUTH_RATE_LIMIT_WINDOW_MS: "0" }), /AUTH_RATE_LIMIT_WINDOW_MS/);
});

const getPostRoutes = (router, path) => router.stack
  .filter((layer) => layer.route?.path === path && layer.route.methods.post);

test("all public login routes use the shared login limiter", () => {
  const loginRoutes = [
    [authRouter, "/login", loginRateLimit],
    [userRouter, "/login", loginRateLimitForPortal("CUSTOMER")],
    [userRouter, "/admin", loginRateLimitForPortal("ADMIN")],
    [manufacturerRouter, "/login", loginRateLimitForPortal("MANUFACTURER")],
    [marketingCardRouter, "/partner/login", loginRateLimitForPortal("MARKETING_PARTNER")],
  ];
  for (const [router, path, expectedLimiter] of loginRoutes) {
    const [route] = getPostRoutes(router, path);
    assert.ok(route, `POST ${path} route exists`);
    assert.equal(route.route.stack[0].handle, expectedLimiter);
    assert.equal(route.route.stack[1].handle, resetLoginRateLimitOnSuccess);
  }
});

test("only public portal signup routes use the registration limiter", () => {
  const [publicManufacturerRegister, adminManufacturerRegister] = getPostRoutes(manufacturerRouter, "/register");
  assert.ok(publicManufacturerRegister);
  assert.ok(adminManufacturerRegister);
  assert.equal(publicManufacturerRegister.route.stack[0].handle, publicRegistrationRateLimit);
  assert.notEqual(adminManufacturerRegister.route.stack[0].handle, publicRegistrationRateLimit);

  const [adminManufacturerRegisterPath] = getPostRoutes(manufacturerRouter, "/admin/register");
  assert.notEqual(adminManufacturerRegisterPath.route.stack[0].handle, publicRegistrationRateLimit);

  const [partnerSignup] = getPostRoutes(marketingCardRouter, "/partner/signup");
  assert.equal(partnerSignup.route.stack[0].handle, publicRegistrationRateLimit);

  const [adminPartnerCreate] = getPostRoutes(marketingCardRouter, "/admin/partners");
  assert.notEqual(adminPartnerCreate.route.stack[0].handle, publicRegistrationRateLimit);
});

test("IP buckets are isolated by portal", () => {
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 10,
    loginIpBucketSize: 1,
    publicRegisterIpBucketSize: 2,
    now: () => 2_000,
  });

  assert.equal(invoke(limiter.login, request({ email: "maker1@example.test", ip: "shared-ip" }), "MANUFACTURER").nextValue, undefined);
  assert.equal(invoke(limiter.login, request({ email: "admin1@example.test", ip: "shared-ip" }), "ADMIN").nextValue, undefined);
  const manufacturerBlocked = invoke(limiter.login, request({ email: "maker2@example.test", ip: "shared-ip" }), "MANUFACTURER");
  assert.equal(manufacturerBlocked.statusCode, 429);
  assert.equal(invoke(limiter.login, request({ email: "admin2@example.test", ip: "shared-ip" }), "ADMIN").nextValue, undefined);
});

test("authenticated login resets username and portal IP buckets, but MFA pending does not", () => {
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 1,
    loginIpBucketSize: 1,
    publicRegisterIpBucketSize: 2,
    now: () => 3_000,
  });
  const loginRequest = request({ email: "admin@example.test", ip: "success-ip" });
  const firstAttempt = invoke(limiter.login, loginRequest, "ADMIN");
  assert.equal(firstAttempt.nextValue, undefined);
  limiter.resetOnSuccessfulLogin(loginRequest, firstAttempt.response, () => {});
  firstAttempt.response.json({ success: true, requiresTwoFactor: true, challengeId: "challenge" });
  assert.equal(invoke(limiter.login, loginRequest, "ADMIN").statusCode, 429);

  const completedLogin = request({ email: "admin@example.test", ip: "success-ip" });
  const admitted = invoke(limiter.login, completedLogin, "ADMIN");
  assert.equal(admitted.nextValue, undefined);
  limiter.resetOnSuccessfulLogin(completedLogin, admitted.response, () => {});
  admitted.response.json({
    success: true,
    accessToken: "test-access-token",
    account: { role: "ADMIN", email: "admin@example.test" },
  });

  assert.equal(invoke(limiter.login, loginRequest, "ADMIN").nextValue, undefined);
  assert.equal(invoke(limiter.login, request({ email: "admin@example.test", ip: "success-ip" }), "ADMIN").nextValue, undefined);
});

test("username buckets are isolated by portal", () => {
  const limiter = createTestLimiters({
    windowMs: 60_000,
    loginUsernameBucketSize: 1,
    loginIpBucketSize: 10,
    publicRegisterIpBucketSize: 2,
    now: () => 2_500,
  });
  const username = "shared@example.test";

  assert.equal(invoke(limiter.login, request({ email: username, ip: "manufacturer-ip" }), "MANUFACTURER").nextValue, undefined);
  assert.equal(invoke(limiter.login, request({ email: username, ip: "admin-ip" }), "ADMIN").nextValue, undefined);
  assert.equal(invoke(limiter.login, request({ email: username, ip: "other-manufacturer-ip" }), "MANUFACTURER").statusCode, 429);
});

test("successful MFA verification routes reset the associated login quota", () => {
  for (const path of ["/2fa/verify", "/admin/2fa/verify"]) {
    const [route] = getPostRoutes(authRouter, path);
    assert.ok(route, `POST ${path} route exists`);
    assert.equal(route.route.stack[0].handle, resetLoginRateLimitOnSuccess);
  }
});