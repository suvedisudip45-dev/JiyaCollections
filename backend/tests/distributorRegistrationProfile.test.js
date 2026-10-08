import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import { prisma } from "../config/db.js";
import {
  registerDistributor,
  updateDistributorAdminProfile,
} from "../controllers/distributorController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const responseRecorder = () => {
  let result;
  return {
    res: {
      status: (status) => ({
        json: (body) => {
          result = { status, body };
          return result;
        },
      }),
      json: (body) => {
        result = { status: 200, body };
        return result;
      },
    },
    result: () => result,
  };
};

test("distributor registration persists manufacturer-equivalent location and pickup details", async (t) => {
  const calls = {};
  stubMethod(t, bcrypt, "hash", async () => "hashed-password");
  stubMethod(t, prisma.authAccount, "findFirst", async () => null);
  stubMethod(t, prisma, "$transaction", async (callback) => callback({
    authAccount: {
      create: async ({ data }) => {
        calls.account = data;
        return { id: "account-1" };
      },
    },
    distributor: {
      create: async ({ data }) => {
        calls.distributor = data;
        return { id: "distributor-1", name: data.name, status: data.status, appliedAt: new Date(0) };
      },
    },
    distributorLocation: {
      create: async ({ data }) => {
        calls.location = data;
        return data;
      },
    },
  }));

  const recorder = responseRecorder();
  await registerDistributor({
    body: {
      name: "Hub One",
      email: "hub@example.com",
      password: "securepass",
      phone: "9841234567",
      province: "Bagmati Province",
      district: "Kathmandu",
      city: "Kathmandu",
      ncmPickupBranch: "Kathmandu",
      street: "Balaju",
      landmark: "Warehouse Gate",
      address: "Full business address",
      pickupAddress: "Courier pickup address",
      pickupContactName: "Contact Person",
      pickupContactPhone: "9801234567",
      pickupWindow: "10 AM - 5 PM",
      returnInstructions: "Call before return",
      contractStartDate: "2026-10-01",
      contractExpiryDate: "2027-10-01",
    },
  }, recorder.res);

  assert.equal(recorder.result().status, 201);
  assert.equal(calls.distributor.province, "Bagmati Province");
  assert.equal(calls.distributor.district, "Kathmandu");
  assert.equal(calls.distributor.street, "Balaju");
  assert.equal(calls.distributor.landmark, "Warehouse Gate");
  assert.equal(calls.distributor.ncmPickupBranch, "KATHMANDU");
  assert.equal(calls.distributor.pickupAddress, "Courier pickup address");
  assert.equal(calls.distributor.pickupContactName, "Contact Person");
  assert.equal(calls.distributor.pickupContactPhone, "9801234567");
  assert.equal(calls.distributor.pickupWindow, "10 AM - 5 PM");
  assert.equal(calls.distributor.returnInstructions, "Call before return");
  assert.equal(calls.distributor.contractStartDate.toISOString().slice(0, 10), "2026-10-01");
  assert.equal(calls.distributor.contractExpiryDate.toISOString().slice(0, 10), "2027-10-01");
  assert.deepEqual(calls.location, {
    distributorId: "distributor-1",
    province: "Bagmati Province",
    district: "Kathmandu",
    isActive: true,
  });
});

test("admin distributor profile updates edit account contact and registration details transactionally", async (t) => {
  const calls = {};
  const existing = {
    id: "distributor-1",
    accountId: "account-1",
    name: "Old Hub",
    phone: "9840000000",
    account: {
      id: "account-1",
      email: "old@example.com",
      phone: "9840000000",
    },
  };
  const tx = {
    distributor: {
      findUnique: async () => existing,
      update: async ({ data }) => {
        calls.profile = data;
        return { ...existing, ...data };
      },
    },
    distributorLocation: {
      upsert: async ({ where, create, update }) => {
        calls.locationCoverage = { where, create, update };
        return create;
      },
    },
    authAccount: {
      update: async ({ data }) => {
        calls.account = data;
        return data;
      },
    },
    systemAuditOutbox: {
      create: async ({ data }) => {
        calls.audit = data.event;
        return { id: "audit-1" };
      },
    },
  };
  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));

  const recorder = responseRecorder();
  await updateDistributorAdminProfile({
    params: { id: "distributor-1" },
    body: {
      name: "Updated Hub",
      email: "updated@example.com",
      phone: "9841234567",
      province: "Lumbini Province",
      district: "Nawalparasi West",
      street: "Main Road",
      landmark: "Near Market",
      city: "Parasi",
      ncmPickupBranch: "Parasi",
      pickupBranchStatus: "VERIFIED",
      contractStartDate: "2026-10-01",
    },
    auth: { accountId: "admin-1", role: "ADMIN" },
    headers: {},
    ip: "127.0.0.1",
  }, recorder.res);

  assert.equal(recorder.result().status, 200);
  assert.equal(calls.profile.name, "Updated Hub");
  assert.equal(calls.profile.province, "Lumbini Province");
  assert.equal(calls.profile.district, "Parasi");
  assert.equal(calls.profile.pickupBranchStatus, "VERIFIED");
  assert.ok(calls.profile.pickupBranchVerifiedAt instanceof Date);
  assert.equal(calls.profile.contractStartDate.toISOString().slice(0, 10), "2026-10-01");
  assert.deepEqual(calls.locationCoverage.create, {
    distributorId: "distributor-1",
    province: "Lumbini Province",
    district: "Parasi",
    isActive: true,
  });
  assert.deepEqual(calls.locationCoverage.update, { isActive: true });
  assert.deepEqual(calls.account, {
    phone: "9841234567",
    email: "updated@example.com",
    isEmailVerified: false,
    isPhoneVerified: false,
  });
  assert.equal(calls.audit.action, "DISTRIBUTOR_PROFILE_UPDATED");
  assert.equal(calls.audit.entityId, "distributor-1");
});
