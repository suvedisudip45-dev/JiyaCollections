import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import { prisma } from "../config/db.js";
import {
  registerDistributor,
  resolveManufacturerDistributorOrigin,
  reviewManufacturerDistributorApplication,
  updateDistributorAdminProfile,
  updateDistributorPickupProfile,
} from "../controllers/distributorController.js";

const stubMethod = (t, target, name, implementation) => {
  const original = target[name];
  target[name] = implementation;
  t.after(() => {
    target[name] = original;
  });
};

const stubLocationLookupData = (t) => {
  stubMethod(t, prisma.locationMapping, "findMany", async () => [
    { code: "BAGM", name: "Bagmati Province", type: "PROVINCE", province: null },
    { code: "0KTM", name: "Kathmandu", type: "DISTRICT", province: "Bagmati Province" },
    { code: "LUMB", name: "Lumbini Province", type: "PROVINCE", province: null },
    { code: "0NWP", name: "Nawalparasi West", type: "DISTRICT", province: "Lumbini Province" },
    { code: "GAND", name: "Gandaki Province", type: "PROVINCE", province: null },
    { code: "0KSK", name: "Kaski", type: "DISTRICT", province: "Gandaki Province" },
  ]);
  stubMethod(t, prisma.ncmBranch, "findMany", async () => [
    { name: "Kathmandu", provinceName: "Bagmati Province", districtName: "Kathmandu", coveredAreas: ["Balaju"] },
    { name: "Parasi", provinceName: "Lumbini Province", districtName: "Parasi", coveredAreas: ["Main Road"] },
    { name: "Pokhara", provinceName: "Gandaki Province", districtName: "Kaski", coveredAreas: ["Lakeside Road"] },
  ]);
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

test("manufacturer distributor origin resolves from a canonical city district", async () => {
  const origin = await resolveManufacturerDistributorOrigin({}, {
    city: "Kaski",
    ncmPickupBranch: "",
  });

  assert.deepEqual(origin, {
    province: "Gandaki Province",
    district: "Kaski",
  });
});

test("manufacturer distributor origin resolves from its NCM pickup branch when city is not a district", async () => {
  const origin = await resolveManufacturerDistributorOrigin({
    ncmBranch: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { name: "POKHARA" });
        return { provinceName: "Gandaki Province", districtName: "Kaski" };
      },
    },
  }, {
    city: "Pokhara",
    ncmPickupBranch: "POKHARA",
  });

  assert.deepEqual(origin, {
    province: "Gandaki Province",
    district: "Kaski",
  });
});

test("manufacturer distributor origin falls back to its first canonical active location", async () => {
  const origin = await resolveManufacturerDistributorOrigin({}, {
    city: "Unknown Factory Hub",
    ncmPickupBranch: "",
    locations: [
      { province: "Gandaki Province", district: "Kaski", isActive: true },
      { province: "Koshi Province", district: "Sankhuwasabha", isActive: true },
      { province: "Bagmati Province", district: "Kathmandu", isActive: false },
    ],
  });

  assert.deepEqual(origin, {
    province: "Gandaki Province",
    district: "Kaski",
  });
});

test("approving manufacturer distributor access copies the business and pickup profile", async (t) => {
  const calls = {};
  const manufacturer = {
    id: "manufacturer-1",
    accountId: "account-1",
    name: "Factory One",
    phone: "9841234567",
    address: "Factory business address",
    city: "Unknown Factory Hub",
    ncmPickupBranch: "POKHARA",
    pickupAddress: "Factory pickup address",
    pickupContactName: "Dispatch Contact",
    pickupContactPhone: "9801234567",
    pickupWindow: "10 AM - 5 PM",
    returnInstructions: "Call before return",
    distributorApplicationStatus: "REQUESTED",
    locations: [{ province: "Gandaki Province", district: "Kaski", isActive: true }],
  };
  const tx = {
    manufacturer: {
      findUnique: async () => manufacturer,
      updateMany: async () => ({ count: 1 }),
    },
    ncmBranch: { findFirst: async () => null },
    distributor: {
      findUnique: async () => null,
      create: async ({ data }) => {
        calls.distributor = data;
        return { id: "distributor-1", ...data };
      },
    },
    distributorLocation: {
      upsert: async (data) => {
        calls.location = data;
        return data.create;
      },
    },
    role: { findUnique: async () => ({ id: "role-distributor", isActive: true }) },
    authAccountRoleMapping: { upsert: async () => ({}) },
    authAuditLog: { create: async () => ({}) },
    systemAuditOutbox: { create: async () => ({ id: "audit-1" }) },
  };
  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));

  const recorder = responseRecorder();
  await reviewManufacturerDistributorApplication({
    params: { id: manufacturer.id },
    body: { status: "APPROVED" },
    auth: { accountId: "admin-1", profileId: "admin-profile-1" },
    headers: {},
    ip: "127.0.0.1",
  }, recorder.res);

  assert.equal(recorder.result().status, 200);
  assert.equal(calls.distributor.name, "Factory One");
  assert.equal(calls.distributor.address, "Factory business address");
  assert.equal(calls.distributor.city, "Unknown Factory Hub");
  assert.equal(calls.distributor.province, "Gandaki Province");
  assert.equal(calls.distributor.district, "Kaski");
  assert.equal(calls.distributor.ncmPickupBranch, "POKHARA");
  assert.equal(calls.distributor.pickupBranchStatus, "UNVERIFIED");
  assert.equal(calls.distributor.pickupAddress, "Factory pickup address");
  assert.equal(calls.distributor.pickupContactName, "Dispatch Contact");
  assert.equal(calls.distributor.pickupContactPhone, "9801234567");
  assert.equal(calls.distributor.pickupWindow, "10 AM - 5 PM");
  assert.equal(calls.distributor.returnInstructions, "Call before return");
  assert.deepEqual(calls.location.create, {
    distributorId: "distributor-1",
    province: "Gandaki Province",
    district: "Kaski",
    isActive: true,
  });
});

test("distributor registration persists manufacturer-equivalent location and pickup details", async (t) => {
  const calls = {};
  stubLocationLookupData(t);
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
  stubLocationLookupData(t);
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

test("distributor self-service pickup profile updates business details and registered coverage", async (t) => {
  const calls = {};
  stubLocationLookupData(t);
  const tx = {
    distributor: {
      findUnique: async () => ({ ncmPickupBranch: "POKHARA" }),
      update: async ({ data }) => {
        calls.profile = data;
        return { id: "distributor-1", accountId: null, ...data };
      },
    },
    distributorLocation: {
      upsert: async (data) => {
        calls.location = data;
        return data.create;
      },
    },
  };
  stubMethod(t, prisma, "$transaction", async (callback) => callback(tx));

  const recorder = responseRecorder();
  await updateDistributorPickupProfile({
    distributorId: "distributor-1",
    body: {
      name: "Updated Hub",
      phone: "9841234567",
      address: "Updated address",
      city: "Pokhara",
      province: "Gandaki Province",
      district: "Kaski",
      street: "Lakeside Road",
      landmark: "Near the lake",
      pickupAddress: "Warehouse entrance",
      pickupContactName: "Hub Contact",
      pickupContactPhone: "9801234567",
    },
  }, recorder.res);

  assert.equal(recorder.result().status, 200);
  assert.equal(calls.profile.name, "Updated Hub");
  assert.equal(calls.profile.address, "Updated address");
  assert.equal(calls.profile.phone, "9841234567");
  assert.equal(calls.profile.pickupAddress, "Warehouse entrance");
  assert.deepEqual(calls.location.create, {
    distributorId: "distributor-1",
    province: "Gandaki Province",
    district: "Kaski",
    isActive: true,
  });
});
