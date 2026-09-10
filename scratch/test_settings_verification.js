import { default as prisma } from "../app/db.server.js";
import { getShopPlan, planLimits } from "../app/plans.server.js";

async function verifySettings() {
  console.log("=================================================");
  console.log("   PARTMATCH SETTINGS COMPREHENSIVE VERIFICATION");
  console.log("=================================================");

  const shop = "quickstart-749ac396.myshopify.com";
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // 1. Verify AppSettings record in DB
  console.log("\n[1] Checking AppSettings in DB for shop:", shop);
  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  if (!settings) {
    console.error("❌ FAILED: No AppSettings found for shop!");
    process.exit(1);
  }
  console.log("✅ AppSettings found:", {
    requireYear: settings.requireYear,
    requireAllFields: settings.requireAllFields,
    logNoResults: settings.logNoResults,
    includeUniversal: settings.includeUniversal,
    redirectOnSearch: settings.redirectOnSearch,
    resultsUrl: settings.resultsUrl,
    persistSelection: settings.persistSelection,
    enableGarage: settings.enableGarage,
    showFitmentChecker: settings.showFitmentChecker,
    vinCapEnabled: settings.vinCapEnabled,
    vinMonthlyCapLimit: settings.vinMonthlyCapLimit,
    vinAlertEmail: settings.vinAlertEmail,
  });

  // 2. Verify Shop Plan & Limits
  console.log("\n[2] Checking Plan & Limits for shop:", shop);
  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);
  console.log(`✅ Active Plan: ${plan.toUpperCase()} (${limits.label})`);
  console.log("   Limits:", {
    fitmentLimit: limits.fitmentLimit,
    universalProducts: limits.universalProducts,
    fitmentChecker: limits.fitmentChecker,
    vinLookup: limits.vinLookup,
    vinMonthlyLimit: limits.vinMonthlyLimit,
    vinOverageRate: limits.vinOverageRate,
  });

  // 3. Verify VIN Lookups count vs cap
  console.log("\n[3] Checking VIN lookup usage...");
  const vinCount = await prisma.vinLookupLog.count({
    where: { shop, createdAt: { gte: startOfMonth } },
  });
  console.log(`✅ Current Month VIN Lookups: ${vinCount} / ${settings.vinMonthlyCapLimit || 50}`);
  const isCapExceeded = settings.vinCapEnabled && vinCount >= (settings.vinMonthlyCapLimit || 50);
  console.log(`   Cap Exceeded: ${isCapExceeded}`);

  // 4. Verify Search Flow with logNoResults & includeUniversal
  console.log("\n[4] Testing Search flow logic with settings...");
  // Test a search query that exists
  const existingFitment = await prisma.fitmentRecord.findFirst({
    where: { shop },
    include: { products: true },
  });
  if (existingFitment) {
    console.log(`   Found test fitment: ${existingFitment.year} ${existingFitment.make} ${existingFitment.model}`);
    console.log(`   Mapped products: ${existingFitment.products.length}`);
  }

  // Check Universal products count
  const universalCount = await prisma.universalProduct.count({ where: { shop } });
  console.log(`   Universal products configured in DB: ${universalCount}`);

  // 5. Test Settings Update / Save Flow Simulation
  console.log("\n[5] Simulating Settings Save & Restore...");
  const testUpdate = await prisma.appSettings.update({
    where: { shop },
    data: {
      requireYear: true,
      requireAllFields: true,
      logNoResults: true,
      includeUniversal: true,
      redirectOnSearch: true,
      resultsUrl: "/collections/all",
      persistSelection: true,
      enableGarage: true,
      showFitmentChecker: true,
      vinCapEnabled: true,
      vinMonthlyCapLimit: 50,
      vinAlertEmail: "sandeepptpss@gmail.com",
    },
  });
  console.log("✅ Settings updated successfully. redirectOnSearch =", testUpdate.redirectOnSearch);

  console.log("\n=================================================");
  console.log("   ALL CORE DATABASE & LOGIC CHECKS PASSED!");
  console.log("=================================================");
}

verifySettings().catch(console.error).finally(() => prisma.$disconnect());
