import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

const roleDefinitions = [
  { code: "ADMIN", name: "Administrator", description: "Administrative access to the platform.", portalScope: "ADMIN" },
  { code: "CUSTOMER", name: "Customer", description: "Customer account access.", portalScope: "CUSTOMER" },
  { code: "MANUFACTURER", name: "Manufacturer", description: "Manufacturer portal access.", portalScope: "MANUFACTURER" },
  { code: "DISTRIBUTOR", name: "Distributor", description: "Distributor portal workspace access.", portalScope: "DISTRIBUTOR" },
  { code: "MARKETING_PARTNER", name: "Marketing Partner", description: "Marketing partner portal access.", portalScope: "MARKETING_PARTNER" },
];

const permissionDefinitions = [
  ["access:audit_read", "Read and export system audit history."],
  ["all:function", "Full server-side authorization bypass for administrators."],
  ["access:admin_users_read", "List and view Admin portal accounts."], ["access:admin_users_create", "Create Admin portal accounts."], ["access:admin_users_update", "Update Admin portal account profiles."], ["access:admin_users_deactivate", "Activate or deactivate Admin portal accounts."], ["access:admin_users_assign_roles", "Assign Admin portal roles to Admin accounts."],
  ["access:marketing_users_read", "List and view Marketing Partner accounts."], ["access:marketing_users_update", "Update Marketing Partner account profiles."], ["access:marketing_users_deactivate", "Activate or deactivate Marketing Partner accounts."],
  ["access:manufacturer_users_read", "List and view Manufacturer accounts."], ["access:manufacturer_users_update", "Update Manufacturer account profiles."], ["access:manufacturer_users_deactivate", "Activate or deactivate Manufacturer accounts."],
  ["access:customer_users_read", "List and view Customer accounts."], ["access:customer_users_update", "Update Customer account profiles."], ["access:customer_users_deactivate", "Activate or deactivate Customer accounts."],
  ["access:roles_read", "List and view Admin portal roles."], ["access:roles_create", "Create Admin portal roles."], ["access:roles_update", "Update Admin portal roles."], ["access:roles_deactivate", "Activate or deactivate Admin portal roles."], ["access:roles_assign_permissions", "Assign permissions to Admin portal roles."], ["access:permissions_read", "View the system permission catalog."],
  ["admin:change_password", "Change an administrator password."],
  ["product:create", "Create products."], ["product:update", "Update products."], ["product:delete", "Delete products."], ["product:list_admin", "Read unpublished products in the administrative catalog."],
  ["stock:adjust", "Adjust product stock."], ["stock:logs_read", "Read stock logs."],
  ["order:list_all", "Read all orders."], ["order:list_admin", "Read administrative order views."], ["order:customer_lookup", "Look up order customers."],
  ["order:customer_verify", "Verify order customers."], ["order:admin_create", "Create orders administratively."],
  ["category:create", "Create categories."], ["category:delete", "Delete categories."],
  ["combo_bundle:create", "Create combo bundles."], ["combo_bundle:update", "Update combo bundles."], ["combo_bundle:delete", "Delete combo bundles."],
  ["subcategory:create", "Create subcategories."], ["subcategory:update", "Update subcategories."], ["subcategory:delete", "Delete subcategories."],
  ["color:create", "Create colors."], ["color:delete", "Delete colors."],
  ["review:admin_list", "Read administrative review listings."], ["review:admin_delete", "Delete reviews administratively."],
  ["shipping:config_update", "Update shipping configuration."], ["loyalty:level_manage", "Manage loyalty levels."],
  ["customer:admin_list", "List customers administratively."], ["customer:admin_detail", "Read customer details administratively."], ["customer:letter_manage", "Manage customer letters."],
  ["offer:list", "List offers."], ["offer:create", "Create offers."], ["offer:update", "Update offers."], ["offer:delete", "Delete offers."],
  ["cogs:read", "Read cost of goods data."], ["cogs:proposals_read", "Read cost proposals."], ["cogs:price_approve", "Approve proposed prices."], ["cogs:price_reject", "Reject proposed prices."],
  ["finance:dashboard_read", "Read the finance dashboard."], ["finance:manufacturer_summary", "Read manufacturer financial summaries."], ["finance:treasury_read", "Read treasury accounts."], ["finance:treasury_create", "Create treasury accounts."], ["finance:cash_transfer", "Transfer cash."], ["finance:expense_record", "Record operating expenses."], ["finance:transactions_read", "Read cash transactions."], ["finance:assets_read", "Read fixed assets."], ["finance:asset_create", "Create fixed assets."], ["finance:depreciation_run", "Run depreciation."], ["finance:asset_damage", "Record damaged assets."], ["finance:captable_read", "Read cap table valuation."], ["finance:partnership_read", "Read partnership data."], ["finance:partner_manage", "Manage partners."], ["finance:shares_issue", "Issue shares."], ["finance:shares_transfer", "Transfer shares."], ["finance:valuation_update", "Update valuation."], ["finance:profit_distribute", "Distribute profits."], ["finance:liabilities_read", "Read liabilities."], ["finance:loan_schedule_read", "Read loan schedules."], ["finance:financing_record", "Record financing."], ["finance:liability_repay", "Repay liabilities."], ["finance:payables_read", "Read payables and receivables."], ["finance:payable_create", "Create payables."], ["finance:receivable_create", "Create receivables."], ["finance:payable_settle", "Settle payables."], ["finance:receivable_collect", "Collect receivables."], ["finance:tax_report_read", "Read tax reports."], ["finance:statements_read", "Read financial statements."],
  ["returns:customer_create", "Request a customer return."], ["returns:customer_read", "Read the customer's return requests."], ["returns:customer_update", "Legacy customer return updates (disabled)."], ["returns:admin_read", "Read customer return requests and history."], ["returns:admin_create", "Create a customer return request administratively."], ["returns:admin_review", "Approve or reject customer return requests."], ["returns:admin_inspect", "Inspect received customer return items."], ["returns:admin_refund", "Complete inspected customer return refunds."], ["returns:supplier_create", "Create supplier returns."], ["returns:supplier_read", "Read supplier returns."],
  ["order:customer_cancel", "Cancel a customer order before NCM handoff."],
  ["exchange:customer_request", "Request an exchange for an eligible delivered order."], ["exchange:customer_read", "Read the customer's own exchange requests."], ["exchange:admin_read", "Read customer exchange requests."], ["exchange:admin_create", "Create exchange requests administratively."], ["exchange:admin_review", "Approve or reject customer exchange requests."], ["exchange:admin_reconcile", "Reconcile NCM exchange order status."],
  ["accounting:coa_read", "Read the chart of accounts."], ["accounting:coa_create", "Create chart of accounts entries."], ["accounting:coa_update", "Update chart of accounts entries."], ["accounting:journal_read", "Read journal entries."], ["accounting:journal_create", "Create journal entries."], ["accounting:journal_reverse", "Reverse journal entries."], ["accounting:ledger_read", "Read the general ledger."], ["accounting:trial_balance_read", "Read trial balances."], ["accounting:statements_read", "Read accounting statements."], ["accounting:subledger_read", "Read subledger reconciliation."], ["accounting:fiscal_years_read", "Read fiscal years."], ["accounting:fiscal_year_create", "Create fiscal years."], ["accounting:period_toggle", "Toggle accounting periods."],
  ["manufacturer:branches_sync", "Synchronize manufacturer branches."], ["manufacturer:profile_read", "Read manufacturer profile."], ["manufacturer:availability_update", "Update manufacturer availability."], ["manufacturer:stats_read", "Read manufacturer statistics."], ["manufacturer:pickup_update", "Update pickup profile."], ["manufacturer:commission_propose", "Propose manufacturer commission."], ["manufacturer:admin_commission_update", "Update manufacturer commission administratively."], ["manufacturer:admin_list", "List manufacturers administratively."], ["manufacturer:admin_sync_ratings", "Synchronize manufacturer ratings."], ["manufacturer:admin_register", "Register manufacturers administratively."], ["manufacturer:admin_quality_update", "Update manufacturer quality ratings."], ["manufacturer:admin_contract_update", "Update manufacturer contract status."], ["manufacturer:admin_contract_upload", "Upload manufacturer contracts."], ["manufacturer:admin_update", "Update manufacturers administratively."], ["manufacturer:production_manage", "Request and manage manufacturer production."], ["manufacturer:production_admin", "Review manufacturer production requests and create production orders."], ["manufacturer:finance_dashboard", "Read the manufacturer's financial dashboard."], ["manufacturer:settlement_request", "Request a manufacturer financial settlement."], ["manufacturer:distributor_request", "Request distributor capability for a manufacturer account."], ["manufacturer:inventory_read", "Read manufacturer inventory."], ["manufacturer:inventory_update", "Update manufacturer inventory."], ["inventory:admin_read_all", "Read all inventory."], ["inventory:admin_low_stock", "Read low-stock inventory."], ["inventory:ledger_read", "Read inventory ledger and reconciliation reports."], ["manufacturer:direct_order_create", "Create direct manufacturer orders."], ["manufacturer:direct_order_read", "Read direct manufacturer orders."], ["manufacturer:direct_order_status_update", "Update direct manufacturer order status."],
  ["distributor:profile_read", "Read the active distributor profile."], ["distributor:availability_update", "Update distributor online/offline availability."], ["distributor:pickup_update", "Update distributor pickup setup and NCM branch coordinates."], ["distributor:admin_list", "List distributor applications administratively."], ["distributor:admin_review", "Approve, reject, or suspend distributor access."],
  ["distributor:inventory_decrease", "Report a distributor inventory decrease for damaged or lost stock."],
  ["distributor:inventory_read", "Read inventory at the active distributor hub."],
  ["distributor:direct_order_create", "Create direct distributor hub orders."], ["distributor:direct_order_read", "Read direct distributor hub orders."], ["distributor:direct_order_status_update", "Update direct distributor hub order status."],
  ["distributor:finance_dashboard", "Read the distributor financial dashboard."], ["distributor:settlement_request", "Request distributor financial settlement."],
  ["distributor:letter_status_read", "Read personalized letter status at distributor hub."], ["distributor:letter_print", "Print personalized letters at distributor hub."],
  ["distributor:loyalty_lookup", "Look up loyalty customers for distributors."], ["distributor:hub_customers_read", "Read distributor hub customer records."], ["distributor:hub_gift_record", "Record distributor hub gifts."], ["distributor:hub_gifts_read", "Read distributor hub gifts."],
  ["distributor:delivery_ready", "Mark distributor orders ready for courier pickup."], ["distributor:delivery_return", "Record distributor delivery returns."],
  ["transfer:distributor_request", "Request bulk stock from a manufacturer."], ["transfer:distributor_read", "Read transfers addressed to the active distributor."], ["transfer:distributor_receive", "Record receipt of bulk stock shipments."], ["transfer:manufacturer_read", "Read manufacturer-originated stock transfers."], ["transfer:manufacturer_dispatch", "Book and dispatch approved bulk stock transfers."], ["transfer:admin_read", "Read all platform stock transfers."], ["transfer:admin_review", "Approve and review stock transfer requests and shipment exceptions."],
  ["assignment:create", "Create assignments."], ["assignment:admin_list", "List assignments administratively."], ["assignment:manual_assign", "Manually assign orders."], ["manufacturer:assignments_read", "Read manufacturer assignments."], ["manufacturer:assignment_detail", "Read assignment details."], ["manufacturer:assignment_accept", "Accept assignments."], ["manufacturer:assignment_reject", "Reject assignments."], ["manufacturer:assignment_status_update", "Update assignment status."],
  ["distributor:assignments_read", "Read customer orders assigned to the active distributor hub."], ["distributor:assignment_detail", "Read assignment details for distributor hub orders."], ["distributor:assignment_accept", "Accept assigned customer order for distributor fulfillment."], ["distributor:assignment_reject", "Reject assigned customer order for distributor hub reallocation."], ["distributor:assignment_status_update", "Update order packing and checklist status at distributor hub."],
  ["expense:create", "Create expenses."], ["expense:read", "Read expenses."], ["expense:update", "Update expenses."], ["expense:delete", "Delete expenses."], ["expense:summary_read", "Read expense summaries."],
  ["manufacturer:delivery_ready", "Mark deliveries ready."], ["manufacturer:delivery_return", "Record delivery returns."], ["customer:delivery_read", "Read customer delivery status."], ["delivery:admin_list", "List deliveries administratively."], ["delivery:settlements_read", "Read delivery settlements."], ["delivery:settlement_summary", "Read settlement summaries."], ["delivery:settlement_request", "Request settlements."], ["delivery:logs_read", "Read delivery logs."], ["delivery:admin_detail", "Read delivery details."], ["delivery:reconcile", "Reconcile deliveries."], ["delivery:ncm_handoff_recover", "Resolve an ambiguous NCM order creation outcome."],
  ["manufacturer:letter_status_read", "Read personalized letter status."], ["manufacturer:letter_print", "Print personalized letters."],
  ["storyletter:admin_manage", "Manage administrative story letters."],
  ["marketing_card:admin_manage", "Manage marketing cards administratively."], ["marketing_card:own_store_manage", "Manage own-store marketing campaigns."], ["marketing_card:custom_assign", "Assign own-store cards to partner or custom organizations."], ["marketing_card:customer_manage", "Use customer marketing card features."], ["marketing_card:partner_manage", "Manage partner marketing cards."], ["marketing_card:distributor_manage", "Manage distributor hub marketing cards."],
  ["customer:profile_read", "Read the customer profile."], ["customer:profile_update", "Update the customer profile."], ["customer:password_change", "Change the customer password."], ["customer:address_manage", "Manage customer addresses."], ["customer:cart_read", "Read the customer cart."], ["customer:cart_write", "Update the customer cart."], ["customer:order_place", "Place customer orders."], ["customer:order_read", "Read customer orders."], ["customer:review_write", "Write customer reviews."], ["customer:review_read", "Read customer review status."], ["customer:review_interact", "Interact with reviews."], ["customer:review_delete", "Delete customer reviews."], ["customer:loyalty_read", "Read customer loyalty status."],
  ["manufacturer:loyalty_lookup", "Look up loyalty customers for manufacturers."], ["manufacturer:hub_customers_read", "Read manufacturer hub customers."], ["manufacturer:hub_gift_record", "Record manufacturer hub gifts."], ["manufacturer:hub_gifts_read", "Read manufacturer hub gifts."],
  ["partner:campaign_manage", "Manage partner campaigns."], ["partner:card_manage", "Manage partner cards."], ["partner:profile_manage", "Manage the partner profile."],
  ["partner:collaboration_read", "Read the partner's collaboration products, sales, and invoices."], ["partner:collaboration_terms_manage", "Propose, counter, or accept collaboration product terms."],
  ["collaboration:admin_manage", "Manage collaboration product assignments and agreements."], ["collaboration:admin_reports_read", "Read collaboration sales and partner fee reports."],
];

const rolePermissionCodes = {
  ADMIN: permissionDefinitions.map(([code]) => code),
  CUSTOMER: permissionDefinitions.map(([code]) => code).filter((code) => (code.startsWith("customer:") && !code.startsWith("customer:admin_")) || code === "marketing_card:customer_manage" || ["order:customer_cancel", "exchange:customer_request", "exchange:customer_read", "returns:customer_create", "returns:customer_read"].includes(code)),
  MANUFACTURER: permissionDefinitions.map(([code]) => code).filter((code) => (code.startsWith("manufacturer:") && !code.startsWith("manufacturer:admin_") && code !== "manufacturer:branches_sync" && ![
    "manufacturer:assignment_accept",
    "manufacturer:assignment_reject",
    "manufacturer:assignment_status_update",
    "manufacturer:collaboration_read",
    "manufacturer:inventory_read",
    "manufacturer:inventory_update",
    "manufacturer:direct_order_create",
    "manufacturer:direct_order_read",
    "manufacturer:direct_order_status_update",
    "manufacturer:loyalty_lookup",
    "manufacturer:hub_customers_read",
    "manufacturer:hub_gift_record",
    "manufacturer:hub_gifts_read",
  ].includes(code)) || code === "finance:manufacturer_summary" || code === "transfer:manufacturer_read" || code === "transfer:manufacturer_dispatch"),
  DISTRIBUTOR: permissionDefinitions.map(([code]) => code).filter((code) => code.startsWith("distributor:") || code.startsWith("marketing_card:distributor") || code === "transfer:distributor_request" || code === "transfer:distributor_read" || code === "transfer:distributor_receive" || code === "returns:customer_read" || code === "returns:supplier_read" || code === "returns:supplier_create"),
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
    const permissionIds = permissionCodes.map((permissionCode) => permissions[permissionCode].id);
    await prisma.rolePermissionMapping.deleteMany({
      where: {
        roleId: roles[roleCode].id,
        permissionId: { notIn: permissionIds },
      },
    });

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
        mustChangePassword: true,
        isEmailVerified: true,
        isPhoneVerified: true,
      },
    });
  } else {
    const adminAccountUpdates = {};
    if (!adminAccount.phone && adminPhone) {
      adminAccountUpdates.phone = adminPhone;
      adminAccountUpdates.role = "ADMIN";
      adminAccountUpdates.status = "ACTIVE";
    }
    if (!adminAccount.passwordChangedAt && !adminAccount.mustChangePassword) {
      adminAccountUpdates.mustChangePassword = true;
    }
    if (Object.keys(adminAccountUpdates).length) {
      adminAccount = await prisma.authAccount.update({
        where: { id: adminAccount.id },
        data: adminAccountUpdates,
      });
    }
  }

  // 2. Idempotently Seed Admin Profile
  const seededAdminDisplayName = String(process.env.ADMIN_DISPLAY_NAME || "System Administrator").trim();
  const seededAdminFirstName = String(process.env.ADMIN_FIRST_NAME || "").trim();
  const seededAdminLastName = String(process.env.ADMIN_LAST_NAME || "").trim();
  const existingAdminProfile = await prisma.admin.findUnique({
    where: { email: adminEmail },
    select: { displayName: true, firstName: true, lastName: true },
  });
  const admin = await prisma.admin.upsert({
    where: { email: adminEmail },
    update: {
      accountId: adminAccount.id,
      phone: adminPhone,
      ...(!existingAdminProfile?.displayName ? { displayName: seededAdminDisplayName } : {}),
      ...(!existingAdminProfile?.firstName && seededAdminFirstName ? { firstName: seededAdminFirstName } : {}),
      ...(!existingAdminProfile?.lastName && seededAdminLastName ? { lastName: seededAdminLastName } : {}),
    },
    create: {
      accountId: adminAccount.id,
      displayName: seededAdminDisplayName,
      firstName: seededAdminFirstName || null,
      lastName: seededAdminLastName || null,
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
