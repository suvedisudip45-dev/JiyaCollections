import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import "dotenv/config";
import { serializeLoginResponse } from "../dtos/authDto.js";
import { resolvePassword, resolveTargetPortal } from "../services/authService.js";

const encrypt = (value) => {
  const key = Buffer.from(process.env.AES_SECRET_KEY, "hex");
  const iv = Buffer.from(process.env.AES_IV, "hex");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString("base64");
};

test("login request decrypts password and target portal without a request IV", () => {
  const body = {
    email: "admin@example.com",
    targetPortal: encrypt("ADMIN"),
    encryptedPassword: encrypt("StrongPass123!"),
  };

  assert.equal(resolvePassword(body), "StrongPass123!");
  assert.equal(resolveTargetPortal(body.targetPortal), "ADMIN");
  assert.equal(Object.hasOwn(body, "iv"), false);
});

test("login response is an explicit allow-list", () => {
  const response = serializeLoginResponse({
    token: "access-token",
    accessToken: "access-token",
    refreshTokenExpiresAt: 1790000000000,
    account: {
      id: "account-id",
      email: "admin@example.com",
      phone: "9846008536",
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash: "must-not-leak",
    },
    profile: { password: "must-not-leak" },
  });

  assert.deepEqual(Object.keys(response).sort(), ["accessToken", "account", "message", "refreshTokenExpiresAt", "success", "token"]);
  assert.deepEqual(Object.keys(response.account).sort(), ["email", "id", "phone", "role", "status"]);
  assert.equal(JSON.stringify(response).includes("password"), false);
  assert.equal(JSON.stringify(response).includes("profile"), false);
  assert.equal(JSON.stringify(response).includes("iv"), false);
});
