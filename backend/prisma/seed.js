import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

const roleDefinitions = [
  { code: "ADMIN", name: "Administrator", description: "Administrative access to the platform." },
  { code: "CUSTOMER", name: "Customer", description: "Customer account access." },
  { code: "MANUFACTURER", name: "Manufacturer", description: "Manufacturer portal access." },
  { code: "MARKETING_PARTNER", name: "Marketing Partner", description: "Marketing partner portal access." },
];

const permissionDefinitions = [
  ["all:function", "Full server-side authorization bypass for administrators."],
  ["admin:change_password", "Change an administrator password."],
  ["product:create", "Create products."], ["product:update", "Update products."], ["product:delete", "Delete products."],
  ["stock:adjust", "Adjust product stock."], ["stock:logs_read", "Read stock logs."],
  ["order:list_all", "Read all orders."], ["order:list_admin", "Read administrative order views."], ["order:customer_lookup", "Look up order customers."],
  ["order:customer_verify", "Verify order customers."], ["order:admin_create", "Create orders administratively."],
  ["category:create", "Create categories."], ["category:delete", "Delete categories."],
  ["subcategory:create", "Create subcategories."], ["subcategory:update", "Update subcategories."], ["subcategory:delete", "Delete subcategories."],
  ["color:create", "Create colors."], ["color:delete", "Delete colors."],
  ["review:admin_list", "Read administrative review listings."], ["review:admin_delete", "Delete reviews administratively."],
  ["shipping:config_update", "Update shipping configuration."], ["loyalty:level_manage", "Manage loyalty levels."],
  ["customer:admin_list", "List customers administratively."], ["customer:admin_detail", "Read customer details administratively."], ["customer:letter_manage", "Manage customer letters."],
  ["offer:list", "List offers."], ["offer:create", "Create offers."], ["offer:update", "Update offers."], ["offer:delete", "Delete offers."],
  ["cogs:read", "Read cost of goods data."], ["cogs:proposals_read", "Read cost proposals."], ["cogs:price_approve", "Approve proposed prices."], ["cogs:price_reject", "Reject proposed prices."],
  ["finance:dashboard_read", "Read the finance dashboard."], ["finance:manufacturer_summary", "Read manufacturer financial summaries."], ["finance:treasury_read", "Read treasury accounts."], ["finance:treasury_create", "Create treasury accounts."], ["finance:cash_transfer", "Transfer cash."], ["finance:expense_record", "Record operating expenses."], ["finance:transactions_read", "Read cash transactions."], ["finance:assets_read", "Read fixed assets."], ["finance:asset_create", "Create fixed assets."], ["finance:depreciation_run", "Run depreciation."], ["finance:asset_damage", "Record damaged assets."], ["finance:captable_read", "Read cap table valuation."], ["finance:partnership_read", "Read partnership data."], ["finance:partner_manage", "Manage partners."], ["finance:shares_issue", "Issue shares."], ["finance:shares_transfer", "Transfer shares."], ["finance:valuation_update", "Update valuation."], ["finance:profit_distribute", "Distribute profits."], ["finance:liabilities_read", "Read liabilities."], ["finance:loan_schedule_read", "Read loan schedules."], ["finance:financing_record", "Record financing."], ["finance:liability_repay", "Repay liabilities."], ["finance:payables_read", "Read payables and receivables."], ["finance:payable_create", "Create payables."], ["finance:receivable_create", "Create receivables."], ["finance:payable_settle", "Settle payables."], ["finance:receivable_collect", "Collect receivables."], ["finance:tax_report_read", "Read tax reports."], ["finance:statements_read", "Read financial statements."],
  ["returns:customer_create", "Create customer returns."], ["returns:customer_read", "Read customer returns."], ["returns:customer_update", "Update customer returns."], ["returns:supplier_create", "Create supplier returns."], ["returns:supplier_read", "Read supplier returns."],
  ["accounting:coa_read", "Read the chart of accounts."], ["accounting:coa_create", "Create chart of accounts entries."], ["accounting:coa_update", "Update chart of accounts entries."], ["accounting:journal_read", "Read journal entries."], ["accounting:journal_create", "Create journal entries."], ["accounting:journal_reverse", "Reverse journal entries."], ["accounting:ledger_read", "Read the general ledger."], ["accounting:trial_balance_read", "Read trial balances."], ["accounting:statements_read", "Read accounting statements."], ["accounting:subledger_read", "Read subledger reconciliation."], ["accounting:fiscal_years_read", "Read fiscal years."], ["accounting:fiscal_year_create", "Create fiscal years."], ["accounting:period_toggle", "Toggle accounting periods."],
  ["manufacturer:branches_sync", "Synchronize manufacturer branches."], ["manufacturer:profile_read", "Read manufacturer profile."], ["manufacturer:availability_update", "Update manufacturer availability."], ["manufacturer:stats_read", "Read manufacturer statistics."], ["manufacturer:pickup_update", "Update pickup profile."], ["manufacturer:commission_propose", "Propose manufacturer commission."], ["manufacturer:admin_list", "List manufacturers administratively."], ["manufacturer:admin_sync_ratings", "Synchronize manufacturer ratings."], ["manufacturer:admin_register", "Register manufacturers administratively."], ["manufacturer:admin_quality_update", "Update manufacturer quality ratings."], ["manufacturer:admin_contract_update", "Update manufacturer contract status."], ["manufacturer:admin_contract_upload", "Upload manufacturer contracts."], ["manufacturer:admin_update", "Update manufacturers administratively."], ["manufacturer:inventory_read", "Read manufacturer inventory."], ["manufacturer:inventory_update", "Update manufacturer inventory."], ["inventory:admin_read_all", "Read all inventory."], ["inventory:admin_low_stock", "Read low-stock inventory."], ["manufacturer:direct_order_create", "Create direct manufacturer orders."], ["manufacturer:direct_order_read", "Read direct manufacturer orders."], ["manufacturer:direct_order_status_update", "Update direct manufacturer order status."],
  ["assignment:create", "Create assignments."], ["assignment:admin_list", "List assignments administratively."], ["assignment:manual_assign", "Manually assign orders."], ["manufacturer:assignments_read", "Read manufacturer assignments."], ["manufacturer:assignment_detail", "Read assignment details."], ["manufacturer:assignment_accept", "Accept assignments."], ["manufacturer:assignment_reject", "Reject assignments."], ["manufacturer:assignment_status_update", "Update assignment status."],
  ["expense:create", "Create expenses."], ["expense:read", "Read expenses."], ["expense:update", "Update expenses."], ["expense:delete", "Delete expenses."], ["expense:summary_read", "Read expense summaries."],
  ["manufacturer:delivery_ready", "Mark deliveries ready."], ["manufacturer:delivery_return", "Record delivery returns."], ["customer:delivery_read", "Read customer delivery status."], ["delivery:admin_list", "List deliveries administratively."], ["delivery:settlements_read", "Read delivery settlements."], ["delivery:settlement_summary", "Read settlement summaries."], ["delivery:settlement_request", "Request settlements."], ["delivery:logs_read", "Read delivery logs."], ["delivery:admin_detail", "Read delivery details."], ["delivery:reconcile", "Reconcile deliveries."],
  ["manufacturer:letter_status_read", "Read personalized letter status."], ["manufacturer:letter_print", "Print personalized letters."],
  ["storyletter:admin_manage", "Manage administrative story letters."],
  ["marketing_card:admin_manage", "Manage marketing cards administratively."], ["marketing_card:manufacturer_manage", "Manage manufacturer marketing cards."], ["marketing_card:customer_manage", "Use customer marketing card features."], ["marketing_card:partner_manage", "Manage partner marketing cards."],
  ["customer:profile_read", "Read the customer profile."], ["customer:profile_update", "Update the customer profile."], ["customer:password_change", "Change the customer password."], ["customer:address_manage", "Manage customer addresses."], ["customer:cart_read", "Read the customer cart."], ["customer:cart_write", "Update the customer cart."], ["customer:order_place", "Place customer orders."], ["customer:order_read", "Read customer orders."], ["customer:review_write", "Write customer reviews."], ["customer:review_read", "Read customer review status."], ["customer:review_interact", "Interact with reviews."], ["customer:review_delete", "Delete customer reviews."], ["customer:loyalty_read", "Read customer loyalty status."],
  ["manufacturer:loyalty_lookup", "Look up loyalty customers for manufacturers."], ["manufacturer:hub_customers_read", "Read manufacturer hub customers."], ["manufacturer:hub_gift_record", "Record manufacturer hub gifts."], ["manufacturer:hub_gifts_read", "Read manufacturer hub gifts."],
  ["partner:campaign_manage", "Manage partner campaigns."], ["partner:card_manage", "Manage partner cards."], ["partner:profile_manage", "Manage the partner profile."],
];

const rolePermissionCodes = {
  ADMIN: permissionDefinitions.map(([code]) => code),
  CUSTOMER: permissionDefinitions.map(([code]) => code).filter((code) => code.startsWith("customer:") && !code.startsWith("customer:admin_")),
  MANUFACTURER: permissionDefinitions.map(([code]) => code).filter((code) => (code.startsWith("manufacturer:") && !code.startsWith("manufacturer:admin_")) || code.startsWith("marketing_card:manufacturer")),
  MARKETING_PARTNER: permissionDefinitions.map(([code]) => code).filter((code) => code.startsWith("partner:") || code.startsWith("marketing_card:partner")),
};

async function seedRbac() {
  const roles = {};
  for (const roleDefinition of roleDefinitions) {
    roles[roleDefinition.code] = await prisma.role.upsert({
      where: { code: roleDefinition.code },
      update: roleDefinition,
      create: roleDefinition,
    });
  }

  const permissions = {};
  for (const [code, description] of permissionDefinitions) {
    permissions[code] = await prisma.permission.upsert({
      where: { code },
      update: { description, isActive: true },
      create: { code, description },
    });
  }

  for (const [roleCode, permissionCodes] of Object.entries(rolePermissionCodes)) {
    for (const permissionCode of permissionCodes) {
      await prisma.rolePermissionMapping.upsert({
        where: { roleId_permissionId: { roleId: roles[roleCode].id, permissionId: permissions[permissionCode].id } },
        update: {},
        create: { roleId: roles[roleCode].id, permissionId: permissions[permissionCode].id },
      });
    }
  }

  const accounts = await prisma.authAccount.findMany({ select: { id: true, role: true } });
  for (const account of accounts) {
    const role = roles[account.role];
    if (!role) {
      throw new Error(`Cannot seed RBAC mapping: unknown AuthAccount role "${account.role}" for account ${account.id}.`);
    }
    await prisma.authAccountRoleMapping.upsert({
      where: { accountId_roleId: { accountId: account.id, roleId: role.id } },
      update: { isActive: true },
      create: { accountId: account.id, roleId: role.id, isActive: true },
    });
  }

  console.log(`✅ RBAC seeded: ${roleDefinitions.length} roles, ${permissionDefinitions.length} permissions, ${accounts.length} account mappings`);
}

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "sudeepsubedi72@gmail.com").toLowerCase().trim();
  const adminPhone = (process.env.ADMIN_SEED_PHONE || "9846008536").trim();
  const rawPassword = process.env.ADMIN_SEED_PASSWORD || "Admin@1234";

  if (!rawPassword || rawPassword.length < 8) {
    throw new Error(
      "ADMIN_SEED_PASSWORD in .env must be at least 8 characters."
    );
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(rawPassword, salt);

  // 1. Idempotently Seed Admin AuthAccount
  let adminAccount = await prisma.authAccount.findUnique({
    where: { email: adminEmail },
  });

  if (!adminAccount) {
    adminAccount = await prisma.authAccount.create({
      data: {
        email: adminEmail,
        phone: adminPhone,
        passwordHash: hashedPassword,
        role: "ADMIN",
        status: "ACTIVE",
        isEmailVerified: true,
        isPhoneVerified: true,
      },
    });
  } else if (!adminAccount.phone && adminPhone) {
    adminAccount = await prisma.authAccount.update({
      where: { id: adminAccount.id },
      data: { phone: adminPhone, role: "ADMIN", status: "ACTIVE" },
    });
  }

  // 2. Idempotently Seed Admin Profile
  const admin = await prisma.admin.upsert({
    where: { email: adminEmail },
    update: {
      accountId: adminAccount.id,
      phone: adminPhone,
    },
    create: {
      accountId: adminAccount.id,
      email: adminEmail,
      password: hashedPassword,
      phone: adminPhone,
    },
  });

  console.log(`✅ Admin seeded: ${admin.email} (Mobile: ${admin.phone})`);
  console.log(
    "⚠️  Remember to change the default password via the Admin Panel → Change Password."
  );

  // 3. Seed Demo Marketing Partner
  const partnerEmail = (process.env.PARTNER_SEED_EMAIL || "partner@aamaclothings.com").toLowerCase().trim();
  const partnerPhone = "9800000000";
  const partnerPassword = process.env.PARTNER_SEED_PASSWORD || "Partner@1234";
  const hashedPartnerPassword = await bcrypt.hash(partnerPassword, salt);

  let partnerAccount = await prisma.authAccount.findUnique({
    where: { email: partnerEmail },
  });

  if (!partnerAccount) {
    partnerAccount = await prisma.authAccount.create({
      data: {
        email: partnerEmail,
        phone: partnerPhone,
        passwordHash: hashedPartnerPassword,
        role: "MARKETING_PARTNER",
        status: "ACTIVE",
        isEmailVerified: true,
        isPhoneVerified: true,
      },
    });
  }

  const partner = await prisma.marketingPartner.upsert({
    where: { email: partnerEmail },
    update: {
      accountId: partnerAccount.id,
    },
    create: {
      accountId: partnerAccount.id,
      code: "DEMO_PARTNER",
      name: "Aama Marketing Partner",
      email: partnerEmail,
      passwordHash: hashedPartnerPassword,
      status: "ACTIVE",
      description: "Official demo marketing partner for promotional campaigns.",
      contactPhone: partnerPhone,
      website: "https://aamaclothings.com",
      address: "Kathmandu, Nepal",
    },
  });

  console.log(`✅ Marketing Partner seeded: ${partner.email} (Code: ${partner.code})`);

  await seedRbac();

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
