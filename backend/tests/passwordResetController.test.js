import assert from "node:assert/strict";
import test from "node:test";
import { requestPasswordReset } from "../controllers/authController.js";

test("password recovery configuration errors return a generic server response", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const result = { statusCode: 200, body: null };
  process.env.NODE_ENV = "production";

  try {
    const response = {
      status(code) {
        result.statusCode = code;
        return {
          json(body) {
            result.body = body;
            return body;
          },
        };
      },
    };
    await requestPasswordReset({
      body: {
        email: "customer@example.test",
        phone: "9812345678",
        portal: "CUSTOMER",
      },
      headers: {},
      ip: "203.0.113.10",
      correlationId: "test-correlation",
    }, response);

    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, {
      success: false,
      message: "Password recovery is temporarily unavailable.",
      code: "PASSWORD_RESET_DISABLED",
    });
    assert.equal(JSON.stringify(result.body).includes("customer@example.test"), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
