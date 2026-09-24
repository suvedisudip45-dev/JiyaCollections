import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

async function main() {
  const email = "sudeepsubedi72@gmail.com";
  const rawPassword = process.env.ADMIN_SEED_PASSWORD || "Admin@1234";

  if (!rawPassword || rawPassword.length < 8) {
    throw new Error(
      "ADMIN_SEED_PASSWORD in .env must be at least 8 characters."
    );
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(rawPassword, salt);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {}, // Do NOT overwrite an existing admin password on re-seed
    create: {
      email,
      password: hashedPassword,
    },
  });

  console.log(`✅ Admin seeded: ${admin.email}`);
  console.log(
    "⚠️  Remember to change the default password via the Admin Panel → Change Password."
  );

  // Seed Demo Marketing Partner
  const partnerEmail = "partner@aamaclothings.com";
  const partnerPassword = process.env.PARTNER_SEED_PASSWORD || "Partner@1234";
  const hashedPartnerPassword = await bcrypt.hash(partnerPassword, salt);

  const partner = await prisma.marketingPartner.upsert({
    where: { email: partnerEmail },
    update: {},
    create: {
      code: "DEMO_PARTNER",
      name: "Aama Marketing Partner",
      email: partnerEmail,
      passwordHash: hashedPartnerPassword,
      status: "ACTIVE",
      description: "Official demo marketing partner for promotional campaigns.",
      contactPhone: "+977 9800000000",
      website: "https://aamaclothings.com",
      address: "Kathmandu, Nepal",
    },
  });

  console.log(`✅ Marketing Partner seeded: ${partner.email} (Code: ${partner.code})`);

  // Seed Nepal Location Mappings (Provinces & 77 Districts with 4-char unique codes)
  const { NEPAL_LOCATION_MAP } = await import("../utils/nepalLocationData.js");
  let seededLocations = 0;
  for (const loc of NEPAL_LOCATION_MAP) {
    await prisma.locationMapping.upsert({
      where: { code: loc.code },
      update: {
        name: loc.name,
        type: loc.type,
        province: loc.province,
      },
      create: {
        code: loc.code,
        name: loc.name,
        type: loc.type,
        province: loc.province,
      },
    });
    seededLocations += 1;
  }
  console.log(`✅ Nepal Location Mappings seeded: ${seededLocations} entries (4-char codes)`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
