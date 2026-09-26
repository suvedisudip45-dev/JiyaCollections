import assert from "node:assert/strict";
import test from "node:test";
import { generateSecureOtp, loadOtpConfig } from "../services/otpService.js";

test("OTP configuration preserves five-minute six-digit defaults", () => {
  assert.deepEqual(loadOtpConfig({}), { expiryMinutes: 5, length: 6 });
  assert.equal(generateSecureOtp(6).length, 6);
});

test("OTP configuration supports validated environment values", () => {
  assert.deepEqual(loadOtpConfig({ OTP_EXPIRY_MINUTES: "7", OTP_LENGTH: "8" }), {
    expiryMinutes: 7,
    length: 8,
  });
  assert.equal(generateSecureOtp(8).length, 8);
  assert.throws(() => loadOtpConfig({ OTP_LENGTH: "2" }), /OTP_LENGTH/);
  assert.throws(() => loadOtpConfig({ OTP_EXPIRY_MINUTES: "0" }), /OTP_EXPIRY_MINUTES/);
});
