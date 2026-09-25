import { prisma } from "../config/db.js";
import { authenticateAccount, logAuthEvent } from "../services/authService.js";
import { createOtpChallenge, verifyOtpChallenge } from "../services/otpService.js";
import bcrypt from "bcryptjs";

async function runTests() {
  console.log("🚀 Starting Unified Authentication Tests...\n");

  try {
    // Test 1: Admin Login with Seeded Credentials
    console.log("1️⃣ Testing Seeded Admin Authentication...");
    const adminResult = await authenticateAccount({
      identifier: "sudeepsubedi72@gmail.com",
      password: process.env.ADMIN_SEED_PASSWORD || "Admin@1234",
      targetPortal: "ADMIN",
    });
    console.log(`✅ Admin authenticated successfully. Role: ${adminResult.account.role}, Phone: ${adminResult.account.phone}`);
    if (adminResult.account.phone !== "9846008536") {
      throw new Error(`Expected admin phone 9846008536, got ${adminResult.account.phone}`);
    }

    // Test 2: Marketing Partner Login with Seeded Credentials
    console.log("\n2️⃣ Testing Seeded Marketing Partner Authentication...");
    const partnerResult = await authenticateAccount({
      identifier: "partner@aamaclothings.com",
      password: process.env.PARTNER_SEED_PASSWORD || "Partner@1234",
      targetPortal: "MARKETING_PARTNER",
    });
    console.log(`✅ Marketing Partner authenticated successfully. Role: ${partnerResult.account.role}`);

    // Test 3: Customer Registration & Login Flow
    console.log("\n3️⃣ Testing Customer Registration and Login Flow...");
    const testEmail = `testcust_${Date.now()}@example.com`;
    const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash("CustPass@1234", salt);

    const { account: custAccount, user: custProfile } = await prisma.$transaction(async (tx) => {
      const acc = await tx.authAccount.create({
        data: {
          email: testEmail,
          phone: testPhone,
          passwordHash: hash,
          role: "CUSTOMER",
          status: "ACTIVE",
        },
      });
      const usr = await tx.user.create({
        data: {
          accountId: acc.id,
          name: "Test Customer",
          email: testEmail,
          phone: testPhone,
          cartData: {},
          addresses: [],
        },
      });
      return { account: acc, user: usr };
    });

    const custLogin = await authenticateAccount({
      identifier: testEmail,
      password: "CustPass@1234",
      targetPortal: "CUSTOMER",
    });
    console.log(`✅ Customer authenticated. ID: ${custLogin.profile.id}, Email: ${custLogin.account.email}`);

    // Test 4: Customer by Phone Login
    console.log("\n4️⃣ Testing Customer Login via Mobile Number...");
    const phoneLogin = await authenticateAccount({
      identifier: testPhone,
      password: "CustPass@1234",
      targetPortal: "CUSTOMER",
    });
    console.log(`✅ Customer phone login passed for ${testPhone}`);

    // Test 5: Cross-Portal Access Control (Customer attempting Admin Portal)
    console.log("\n5️⃣ Testing Cross-Portal Authorization Barrier (Customer -> Admin Portal)...");
    let crossPortalBlocked = false;
    try {
      await authenticateAccount({
        identifier: testEmail,
        password: "CustPass@1234",
        targetPortal: "ADMIN",
      });
    } catch (err) {
      crossPortalBlocked = true;
      console.log(`✅ Cross-portal access correctly rejected: "${err.message}"`);
    }
    if (!crossPortalBlocked) {
      throw new Error("Security failure: Customer was able to authenticate into ADMIN portal!");
    }

    // Test 6: OTP Lifecycle Test
    console.log("\n6️⃣ Testing OTP Challenge Lifecycle...");
    const otpDest = "9846008536";
    const challenge = await createOtpChallenge({
      destination: otpDest,
      purpose: "LOGIN",
      channel: "SMS",
    });
    console.log(`✅ OTP Challenge created: ${challenge.challengeId}`);

    // Retrieve active challenge from DB to test verification
    const activeChallenge = await prisma.otpChallenge.findUnique({
      where: { id: challenge.challengeId },
    });
    // Test wrong OTP code
    let wrongCodeBlocked = false;
    try {
      await verifyOtpChallenge({
        destination: otpDest,
        purpose: "LOGIN",
        code: "000000",
      });
    } catch (err) {
      wrongCodeBlocked = true;
      console.log(`✅ Invalid OTP code correctly blocked: "${err.message}"`);
    }

    // Test 8: Verify authAdmin middleware with admin token (Testing endpoint /api/manufacturer/admin/branches/sync)
    console.log("\n8️⃣ Testing authAdmin & adminAuth middleware execution...");
    const { authAdmin } = await import("../middleware/auth.js");
    const { default: adminAuth } = await import("../middleware/adminAuth.js");

    let authAdminPassed = false;
    const reqMock1 = {
      headers: { token: adminResult.token },
      body: {},
    };
    const resMock1 = {
      status: (code) => ({ json: (d) => console.log("resMock1 error:", code, d) }),
      json: (d) => console.log("resMock1 json:", d),
    };
    await authAdmin(reqMock1, resMock1, () => {
      authAdminPassed = true;
    });

    if (!authAdminPassed || reqMock1.role && reqMock1.role !== "ADMIN") {
      throw new Error("authAdmin failed to authorize admin token");
    }
    console.log("✅ authAdmin passed for admin token (Fixes /api/manufacturer/admin/branches/sync)");

    let adminAuthPassed = false;
    const reqMock2 = {
      headers: { token: adminResult.token },
      body: {},
    };
    await adminAuth(reqMock2, resMock1, () => {
      adminAuthPassed = true;
    });
    if (!adminAuthPassed) {
      throw new Error("adminAuth failed to authorize admin token");
    }
    console.log("✅ adminAuth passed for admin token");

    console.log("\n🎉 ALL UNIFIED AUTHENTICATION TESTS PASSED PERFECTLY!\n");
  } catch (error) {
    console.error("❌ Test Failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
