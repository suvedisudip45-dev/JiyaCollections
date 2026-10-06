import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import "dotenv/config";
import { serializeLoginResponse, serializeSessionProfile } from "../dtos/authDto.js";
import {
  getAccountWorkspaceRoles,
  isWorkspaceProfileActive,
  resolvePassword,
  resolveTargetPortal,
} from "../services/authService.js";
import {
  clearRefreshCookie,
  getRefreshCookie,
  setRefreshCookie,
} from "../utils/refreshCookie.js";

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

test("workspace access includes only active role mappings with active profiles", () => {
  const account = {
    role: "MANUFACTURER",
    manufacturerProfile: { id: "manufacturer-1" },
    distributorProfile: { id: "distributor-1", status: "ACTIVE", isActive: true },
    roleMappings: [
      { isActive: true, role: { code: "MANUFACTURER", isActive: true } },
      { isActive: true, role: { code: "DISTRIBUTOR", isActive: true } },
      { isActive: true, role: { code: "ADMIN", isActive: false } },
      { isActive: false, role: { code: "CUSTOMER", isActive: true } },
    ],
  };

  assert.deepEqual(getAccountWorkspaceRoles(account), ["MANUFACTURER", "DISTRIBUTOR"]);
  assert.equal(isWorkspaceProfileActive(account, "MANUFACTURER"), true);
  assert.equal(isWorkspaceProfileActive(account, "DISTRIBUTOR"), true);
  assert.equal(isWorkspaceProfileActive({ ...account, distributorProfile: { ...account.distributorProfile, status: "PENDING_APPROVAL" } }, "DISTRIBUTOR"), false);
  assert.equal(isWorkspaceProfileActive({ ...account, manufacturerProfile: null }, "MANUFACTURER"), false);
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
      mustChangePassword: true,
      passwordHash: "must-not-leak",
    },
    profile: { password: "must-not-leak" },
  });

  assert.deepEqual(Object.keys(response).sort(), ["accessToken", "account", "message", "refreshTokenExpiresAt", "success", "token"]);
  assert.deepEqual(Object.keys(response.account).sort(), [
    "availableWorkspaces",
    "email",
    "id",
    "mustChangePassword",
    "phone",
    "primaryRole",
    "role",
    "status",
  ]);
  assert.equal(response.account.mustChangePassword, true);
  assert.equal(JSON.stringify(response).includes("password"), false);
  assert.equal(JSON.stringify(response).includes("profile"), false);
  assert.equal(JSON.stringify(response).includes("iv"), false);
});

test("session profile serialization excludes password hashes and unrelated portals", () => {
  const adminResponse = serializeSessionProfile({
    id: "account-1",
    email: "admin@example.com",
    phone: "9800000000",
    role: "ADMIN",
    status: "ACTIVE",
    passwordHash: "account-hash",
    adminProfile: { id: "admin-1", email: "admin@example.com", phone: "9800000000", password: "legacy-hash" },
    customerProfile: { id: "customer-1", password: "unrelated-hash" },
    manufacturerProfile: { id: "manufacturer-1", password: "unrelated-hash" },
    marketingPartnerProfile: { id: "partner-1", passwordHash: "unrelated-hash" },
  });
  const serialized = JSON.stringify(adminResponse);
  assert.equal(serialized.includes("hash"), false);
  assert.equal(Object.hasOwn(adminResponse, "user"), false);
  assert.equal(Object.hasOwn(adminResponse, "manufacturer"), false);
  assert.equal(Object.hasOwn(adminResponse, "partner"), false);

  const customerResponse = serializeSessionProfile({
    id: "account-2",
    email: "customer@example.com",
    role: "CUSTOMER",
    status: "ACTIVE",
    customerProfile: { id: "customer-2", name: "Customer", password: "legacy-hash" },
    adminProfile: { id: "admin-2", password: "unrelated-hash" },
  });
  assert.equal(customerResponse.user.name, "Customer");
  assert.equal(Object.hasOwn(customerResponse, "manufacturer"), false);
  assert.equal(JSON.stringify(customerResponse).includes("hash"), false);
});

test("refresh cookies are isolated by portal", () => {
  const issuedCookies = new Map();
  const clearedCookies = [];
  const response = {
    cookie: (name, value) => issuedCookies.set(name, value),
    clearCookie: (name) => clearedCookies.push(name),
  };

  setRefreshCookie(response, "CUSTOMER", "customer-refresh", Date.now() + 60_000);
  setRefreshCookie(response, "ADMIN", "admin-refresh", Date.now() + 60_000);

  const request = {
    headers: {
      cookie: "refresh_token_customer=customer-refresh; refresh_token_admin=admin-refresh",
    },
  };

  assert.equal(getRefreshCookie(request, "CUSTOMER"), "customer-refresh");
  assert.equal(getRefreshCookie(request, "ADMIN"), "admin-refresh");
  assert.equal(getRefreshCookie(request, "MANUFACTURER"), "");

  clearRefreshCookie(response, "ADMIN");
  assert.deepEqual(clearedCookies, ["refresh_token_admin"]);
  assert.equal(issuedCookies.get("refresh_token_customer"), "customer-refresh");
});
