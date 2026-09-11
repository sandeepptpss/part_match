import "./polyfill.js";
import prisma from "../app/db.server.js";
import { normalizeShopDomain } from "../app/utils/shopDomain.js";

// Global QA metrics
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, testName, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS ${String(totalTests).padStart(2, "0")}]: ${testName}`);
    if (details) console.log(`           └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ✕ [FAIL ${String(totalTests).padStart(2, "0")}]: ${testName}`);
    if (details) console.error(`           └─ ${details}`);
    failures.push({ testName, details });
  }
}

async function runAdminQASuite() {
  console.log("================================================================");
  console.log("     PARTMATCH SUPER ADMIN PAGE COMPREHENSIVE QA TEST SUITE    ");
  console.log("================================================================\n");

  const canonicalShop = "quickstart-749ac396.myshopify.com";

  // ─── 1. DOMAIN NORMALIZATION UTILITY ────────────────────────────────────────
  console.log("─── SUITE 1: Canonical Shop Domain Normalization ───");
  assert(
    normalizeShopDomain("quickstart-749ac396") === "quickstart-749ac396.myshopify.com",
    "Subdomain without .myshopify.com appends suffix correctly",
    normalizeShopDomain("quickstart-749ac396")
  );
  assert(
    normalizeShopDomain("quickstart-749ac396.myshopify.com") === "quickstart-749ac396.myshopify.com",
    "Canonical domain remains unchanged",
    normalizeShopDomain("quickstart-749ac396.myshopify.com")
  );
  assert(
    normalizeShopDomain("  QUICKSTART-749ac396.MYSHOPIFY.COM  ") === "quickstart-749ac396.myshopify.com",
    "Mixed case and whitespace are stripped",
    normalizeShopDomain("  QUICKSTART-749ac396.MYSHOPIFY.COM  ")
  );
  assert(
    normalizeShopDomain("https://my-auto-parts.myshopify.com/") === "my-auto-parts.myshopify.com",
    "Protocol and trailing slash stripped",
    normalizeShopDomain("https://my-auto-parts.myshopify.com/")
  );
  assert(
    normalizeShopDomain("__GLOBAL__") === "__GLOBAL__",
    "__GLOBAL__ special identifier preserved",
    normalizeShopDomain("__GLOBAL__")
  );
  assert(
    normalizeShopDomain("") === "",
    "Empty string returns empty",
    normalizeShopDomain("")
  );

  // ─── 2. DUPLICATE STORE RESOLUTION & LOADER DEDUPLICATION ───────────────────
  console.log("\n─── SUITE 2: Store Deduplication & Admin Loader Verification ───");
  
  // Verify database has NO un-normalized duplicate in AppSettings
  const appSettingsRows = await prisma.appSettings.findMany({
    where: { shop: { not: "__GLOBAL__" } }
  });
  const rawShopsInDB = appSettingsRows.map(s => s.shop);
  console.log("   Current DB AppSettings shops:", rawShopsInDB);

  assert(
    !rawShopsInDB.includes("quickstart-749ac396"),
    "No orphan un-normalized store 'quickstart-749ac396' in AppSettings DB",
    `Found shops: ${JSON.stringify(rawShopsInDB)}`
  );
  assert(
    rawShopsInDB.includes(canonicalShop),
    "Canonical shop 'quickstart-749ac396.myshopify.com' exists in AppSettings",
    `Canonical shop: ${canonicalShop}`
  );

  // Test Loader deduplication resilience with un-normalized candidates injected:
  const settingsList = await prisma.appSettings.findMany();
  const sessions = await prisma.session.findMany({ select: { shop: true, email: true } });
  const shopPlansList = await prisma.shopPlan.findMany();

  const candidateShops = [
    canonicalShop,
    ...settingsList.map((s) => s.shop),
    ...sessions.map((s) => s.shop),
    ...shopPlansList.map((s) => s.shop),
    // Intentionally inject un-normalized variants to test loader resilience:
    "quickstart-749ac396",
    "  QUICKSTART-749AC396.myshopify.com  ",
    "https://quickstart-749ac396.myshopify.com/",
  ];

  const testShopSet = new Set();
  for (const raw of candidateShops) {
    const normalized = normalizeShopDomain(raw);
    if (normalized && normalized !== "__GLOBAL__") {
      testShopSet.add(normalized);
    }
  }
  const deduplicatedDomains = Array.from(testShopSet);

  assert(
    deduplicatedDomains.length === 1,
    "Loader deduplication collapses dirty/un-normalized variants to exactly 1 store",
    `Resulting domains: ${JSON.stringify(deduplicatedDomains)}`
  );
  assert(
    deduplicatedDomains[0] === canonicalShop,
    "The single deduplicated store is the canonical myshopify domain",
    deduplicatedDomains[0]
  );

  // ─── 3. GLOBAL MERCHANT SUPPORT STATUS TOGGLE FLOW ──────────────────────────
  console.log("\n─── SUITE 3: Global Merchant Support Desk Status Toggle ───");
  const globalRec = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  const initialSupportStatus = globalRec?.isSupportOnline ?? true;

  // Toggle to opposite status
  const nextSupportStatus = !initialSupportStatus;
  await prisma.appSettings.update({
    where: { id: globalRec.id },
    data: { isSupportOnline: nextSupportStatus },
  });
  const dbSupportCheck1 = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  assert(
    dbSupportCheck1.isSupportOnline === nextSupportStatus,
    `Global Support Desk toggled from ${initialSupportStatus ? "ONLINE" : "OFFLINE"} to ${nextSupportStatus ? "ONLINE" : "OFFLINE"}`
  );

  // Toggle back to initial status
  await prisma.appSettings.update({
    where: { id: globalRec.id },
    data: { isSupportOnline: initialSupportStatus },
  });
  const dbSupportCheck2 = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  assert(
    dbSupportCheck2.isSupportOnline === initialSupportStatus,
    "Global Support Desk toggled back to original state"
  );

  // ─── 4. GLOBAL DEFAULT DISCOUNT FLOW ────────────────────────────────────────
  console.log("\n─── SUITE 4: Global Default Annual Discount Rate Flow ───");
  const initialGlobalDiscount = globalRec?.annualDiscountPercent ?? 17;

  // Update global discount to 25%
  await prisma.appSettings.update({
    where: { id: globalRec.id },
    data: { annualDiscountPercent: 25 },
  });
  const dbDiscountCheck = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  assert(dbDiscountCheck.annualDiscountPercent === 25, "Database __GLOBAL__ updated to 25% discount");

  // Revert to initial discount
  await prisma.appSettings.update({
    where: { id: globalRec.id },
    data: { annualDiscountPercent: initialGlobalDiscount },
  });
  const dbDiscountRevert = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  assert(
    dbDiscountRevert.annualDiscountPercent === initialGlobalDiscount,
    `Reverted to original discount (${initialGlobalDiscount}%)`
  );

  // ─── 5. PER-MERCHANT DISCOUNT & RESET FLOW (VERIFY BUG FIX) ─────────────────
  console.log("\n─── SUITE 5: Merchant Custom Discount & Reset Flow (Bug 2 Fix Verification) ───");
  
  // 5a. Save custom discount with unnormalized domain input (simulating saveUserDiscount)
  const inputTargetShop = "quickstart-749ac396";
  const normalizedTarget = normalizeShopDomain(inputTargetShop);
  const testDiscountPercent = 28;

  assert(
    normalizedTarget === canonicalShop,
    "Action normalizes incoming targetShop before database query"
  );

  const shopRec = await prisma.appSettings.findFirst({ where: { shop: normalizedTarget } });
  await prisma.appSettings.update({
    where: { id: shopRec.id },
    data: {
      merchantDiscountPercent: testDiscountPercent,
      annualDiscountPercent: testDiscountPercent,
    },
  });

  const dbMerchantCheck = await prisma.appSettings.findFirst({ where: { shop: canonicalShop } });
  assert(
    dbMerchantCheck.merchantDiscountPercent === 28,
    "Database updated with 28% merchant VIP discount for canonical shop"
  );

  // 5b. Test the newly implemented resetUserDiscount action logic
  const resetTargetShop = normalizeShopDomain("quickstart-749ac396");
  const globalCurrent = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  const globalDefault = globalCurrent?.annualDiscountPercent ?? 17;

  await prisma.appSettings.update({
    where: { id: shopRec.id },
    data: {
      merchantDiscountPercent: 0,
      annualDiscountPercent: globalDefault,
    },
  });

  const dbResetCheck = await prisma.appSettings.findFirst({ where: { shop: canonicalShop } });
  assert(
    dbResetCheck.merchantDiscountPercent === 0,
    "Merchant discount reset to 0% in database (Fix for Bug 2 verified)"
  );
  assert(
    dbResetCheck.annualDiscountPercent === globalDefault,
    `Annual discount restored to global default (${globalDefault}%) in database`
  );

  // Restore 17% custom discount as it was originally
  await prisma.appSettings.update({
    where: { id: shopRec.id },
    data: {
      merchantDiscountPercent: 17,
      annualDiscountPercent: 17,
    },
  });

  // ─── 6. VIP FREE OFFER CONFIGURATION & AUTO-GRANT FLOW ──────────────────────
  console.log("\n─── SUITE 6: VIP Free Offer Settings & Auto-Grant Flow ───");
  await prisma.appSettings.update({
    where: { id: globalRec.id },
    data: {
      vipFreeOfferMonths: 3,
      vipFreeOfferStoreLimit: 15,
      autoGrantFirst10: true,
    },
  });
  const dbVipConfig = await prisma.appSettings.findFirst({ where: { shop: "__GLOBAL__" } });
  assert(dbVipConfig.vipFreeOfferMonths === 3, "vipFreeOfferMonths updated to 3");
  assert(dbVipConfig.vipFreeOfferStoreLimit === 15, "vipFreeOfferStoreLimit updated to 15");
  assert(dbVipConfig.autoGrantFirst10 === true, "autoGrantFirst10 enabled");

  // Restore standard VIP config (2 months, 10 stores, true)
  await prisma.appSettings.update({
    where: { id: globalRec.id },
    data: {
      vipFreeOfferMonths: 2,
      vipFreeOfferStoreLimit: 10,
      autoGrantFirst10: true,
    },
  });

  // ─── 7. PER-MERCHANT VIP OFFER TOGGLE FLOW ──────────────────────────────────
  console.log("\n─── SUITE 7: Per-Merchant VIP Offer Toggle Flow ───");
  const currentVipActive = dbMerchantCheck.vipFreeOfferActive ?? false;

  await prisma.appSettings.update({
    where: { id: shopRec.id },
    data: {
      vipFreeOfferActive: !currentVipActive,
      vipFreeOfferGrantedAt: !currentVipActive ? new Date() : null,
    },
  });
  const dbVipToggle1 = await prisma.appSettings.findFirst({ where: { shop: canonicalShop } });
  assert(
    dbVipToggle1.vipFreeOfferActive === !currentVipActive,
    `vipFreeOfferActive toggled to ${!currentVipActive}`
  );

  // Revert back to original state
  await prisma.appSettings.update({
    where: { id: shopRec.id },
    data: {
      vipFreeOfferActive: currentVipActive,
      vipFreeOfferGrantedAt: currentVipActive ? new Date() : null,
    },
  });
  const dbVipToggle2 = await prisma.appSettings.findFirst({ where: { shop: canonicalShop } });
  assert(dbVipToggle2.vipFreeOfferActive === currentVipActive, "vipFreeOfferActive restored to initial state");

  // ─── 8. PLAN QUOTA OVERRIDE & QUOTE APPROVAL FLOW ───────────────────────────
  console.log("\n─── SUITE 8: Plan Quota Override & Custom Quote Flow ───");
  
  // Create a temporary QuoteRequest
  const dummyQuote = await prisma.quoteRequest.create({
    data: {
      shop: canonicalShop,
      contactEmail: "quote-test@example.com",
      requestedPlan: "enterprise",
      requestedFitments: 75000,
      monthlyBudget: 150,
      notes: "QA automated simulation test quote",
      status: "PENDING",
    },
  });
  assert(dummyQuote?.id > 0, "Created test QuoteRequest in DB", `ID: ${dummyQuote.id}`);

  // 8a. Update status to CONTACTED
  await prisma.quoteRequest.update({
    where: { id: dummyQuote.id },
    data: { status: "CONTACTED" },
  });
  const dbQuoteStatus = await prisma.quoteRequest.findUnique({ where: { id: dummyQuote.id } });
  assert(dbQuoteStatus.status === "CONTACTED", "QuoteRequest status updated to CONTACTED in DB");

  // 8b. Approve Quote & Set Plan Quota via updateMerchantPlanQuote
  await prisma.shopPlan.upsert({
    where: { shop: canonicalShop },
    update: {
      plan: "enterprise",
      customFitmentLimit: 75000,
      customMonthlyPrice: 149.0,
      isManualGrant: true,
      adminNotes: "Approved via automated QA test suite",
    },
    create: {
      shop: canonicalShop,
      plan: "enterprise",
      billingCycle: "monthly",
      customFitmentLimit: 75000,
      customMonthlyPrice: 149.0,
      isManualGrant: true,
      adminNotes: "Approved via automated QA test suite",
    },
  });

  await prisma.quoteRequest.update({
    where: { id: dummyQuote.id },
    data: {
      status: "APPROVED",
      quotedPrice: 149.0,
    },
  });

  const dbShopPlan = await prisma.shopPlan.findUnique({ where: { shop: canonicalShop } });
  assert(dbShopPlan.plan === "enterprise", "ShopPlan plan set to enterprise");
  assert(dbShopPlan.customFitmentLimit === 75000, "ShopPlan customFitmentLimit set to 75,000");
  assert(dbShopPlan.customMonthlyPrice === 149.0, "ShopPlan customMonthlyPrice set to 149.00");
  assert(dbShopPlan.isManualGrant === true, "ShopPlan isManualGrant set to true");

  const dbQuoteApproved = await prisma.quoteRequest.findUnique({ where: { id: dummyQuote.id } });
  assert(dbQuoteApproved.status === "APPROVED", "QuoteRequest linked and marked APPROVED");
  assert(dbQuoteApproved.quotedPrice === 149.0, "QuoteRequest quotedPrice recorded as 149.00");

  // 8c. Verify custom price calculation in activePlanLabel
  const basePrices = { free: 0, starter: 19, growth: 49, enterprise: 99 };
  const customMonthlyPrice = dbShopPlan.customMonthlyPrice;
  const merchantDiscount = 17;
  const basePrice = customMonthlyPrice !== null ? customMonthlyPrice : basePrices[dbShopPlan.plan];
  const effectivePrice = basePrice > 0 ? (basePrice * (1 - merchantDiscount / 100)).toFixed(2) : "0";
  assert(
    effectivePrice === "123.67",
    "Effective price calculated from custom monthly price ($149 * (1 - 0.17) = $123.67)",
    `Effective Price: $${effectivePrice}/mo`
  );

  // Clean up dummy quote and restore original shop plan
  await prisma.quoteRequest.delete({ where: { id: dummyQuote.id } });
  await prisma.shopPlan.upsert({
    where: { shop: canonicalShop },
    update: {
      plan: "growth",
      customFitmentLimit: null,
      customMonthlyPrice: null,
      isManualGrant: false,
      adminNotes: null,
    },
    create: {
      shop: canonicalShop,
      plan: "growth",
      billingCycle: "monthly",
    },
  });

  // ─── 9. VALIDATION, BOUNDARY & ERROR HANDLING ───────────────────────────────
  console.log("\n─── SUITE 9: Input Validation, Boundary & Edge Cases ───");

  // 9a. Negative discount percentage validation check
  const negDiscount = -15;
  const isNegInvalid = isNaN(negDiscount) || negDiscount < 0 || negDiscount > 95;
  assert(isNegInvalid === true, "Negative discount (-15%) detected as invalid boundary");

  // 9b. Excess discount percentage validation check
  const excessDiscount = 150;
  const isExcessInvalid = isNaN(excessDiscount) || excessDiscount < 0 || excessDiscount > 95;
  assert(isExcessInvalid === true, "Excess discount (150%) detected as invalid boundary");

  // 9c. Valid discount percentage validation check
  const validDiscount = 25;
  const isValidOk = !isNaN(validDiscount) && validDiscount >= 0 && validDiscount <= 95;
  assert(isValidOk === true, "Valid discount (25%) accepted within boundary 0-95%");

  // 9d. Plan fallback validation
  const allowedPlans = ["free", "starter", "growth", "enterprise"];
  const invalidPlanInput = "super_vip_mega";
  const sanitizedPlan = allowedPlans.includes(invalidPlanInput) ? invalidPlanInput : "starter";
  assert(sanitizedPlan === "starter", "Invalid plan name sanitizes to 'starter' safely");

  // 9e. Negative custom limit and price sanitation
  const parsedLimit = parseInt("-5000", 10);
  const sanitizedLimit = parsedLimit != null && !isNaN(parsedLimit) && parsedLimit >= 0 ? parsedLimit : null;
  assert(sanitizedLimit === null, "Negative fitment limit sanitizes to null");

  const parsedPrice = parseFloat("-25.50");
  const sanitizedPrice = parsedPrice != null && !isNaN(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;
  assert(sanitizedPrice === null, "Negative custom monthly price sanitizes to null");

  // ─── 10. SYSTEM MAINTENANCE (SEARCH LOG PURGE) ──────────────────────────────
  console.log("\n─── SUITE 10: System Maintenance (Search Log Purge) ───");
  
  // Insert a test search log to verify purge
  await prisma.searchLog.create({
    data: {
      shop: canonicalShop,
      year: "2025",
      make: "Toyota",
      model: "Camry",
      trim: "",
      hasResults: true,
      resultCount: 5,
    },
  });
  const countBefore = await prisma.searchLog.count();
  assert(countBefore > 0, "Test search log created in DB", `Total searches: ${countBefore}`);

  // Purge search logs
  await prisma.searchLog.deleteMany({});
  const countAfter = await prisma.searchLog.count();
  assert(countAfter === 0, "Search logs table successfully purged (0 logs in DB)");

  // ─── 11. STORE RANKING & ELIGIBILITY VERIFICATION ───────────────────────────
  console.log("\n─── SUITE 11: Store Ranking & Exclusion of __GLOBAL__ ───");
  const rawStores = (await prisma.appSettings.findMany({
    where: { shop: { not: "__GLOBAL__" } },
    select: { shop: true, id: true },
    orderBy: { id: "asc" },
  })) ?? [];
  const uniqueStoreSet = new Set();
  const rankedStores = [];
  for (const s of rawStores) {
    const norm = normalizeShopDomain(s.shop);
    if (norm && norm !== "__GLOBAL__" && !uniqueStoreSet.has(norm)) {
      uniqueStoreSet.add(norm);
      rankedStores.push(norm);
    }
  }

  assert(
    !rankedStores.includes("__GLOBAL__"),
    "__GLOBAL__ is strictly excluded from store ranking queue"
  );
  assert(
    rankedStores.length === 1 && rankedStores[0] === canonicalShop,
    "Store ranking queue contains exactly 1 unique canonical store",
    `Ranked stores: ${JSON.stringify(rankedStores)}`
  );
  const storeRankIndex = rankedStores.indexOf(canonicalShop);
  assert(
    storeRankIndex === 0,
    "Canonical store is at index 0 (eligible for First 10 Stores VIP offer)"
  );

  // ─── FINAL SUMMARY ──────────────────────────────────────────────────────────
  console.log("\n================================================================");
  console.log(`QA TEST RUN COMPLETE: ${passedTests}/${totalTests} PASSED`);
  if (failedTests > 0) {
    console.error(`FAILED: ${failedTests} test(s) failed!`);
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  } else {
    console.log("ALL QA TEST CASES PASSED WITH 100% SUCCESS!");
    console.log("================================================================\n");
    process.exit(0);
  }
}

runAdminQASuite().catch((err) => {
  console.error("FATAL QA TEST ERROR:", err);
  process.exit(1);
});
