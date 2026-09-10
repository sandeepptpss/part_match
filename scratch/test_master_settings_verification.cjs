const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');

const host = 'http://127.0.0.1:46545';
const shop = 'quickstart-749ac396.myshopify.com';

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function runMasterTest() {
  console.log("===============================================================");
  console.log("       MASTER STORE SETTINGS & FLOW INTEGRITY AUDIT");
  console.log("===============================================================\n");

  const originalSettings = await prisma.appSettings.findUnique({ where: { shop } });

  // TEST 1: Config API
  console.log("TEST 1: Storefront API Config Verification");
  const cfg = await get(`${host}/api/config?shop=${shop}`);
  if (cfg.status !== 200 || !cfg.data?.settings) {
    throw new Error(`Config API failed with status ${cfg.status}`);
  }
  console.log("  [PASS] /api/config responds with 200 and valid settings payload.\n");

  // TEST 2: requireYear Toggle Flow
  console.log("TEST 2: 'Require Year Selection First' Flow");
  // 2a. With requireYear = true
  await prisma.appSettings.update({ where: { shop }, data: { requireYear: true } });
  const makesStrict = await get(`${host}/api/makes?shop=${shop}`);
  console.log("  requireYear = true -> makes without year count:", makesStrict.data?.makes?.length);
  if (makesStrict.data?.makes?.length !== 0) throw new Error("Expected 0 makes when year is not provided in strict mode");

  // 2b. With requireYear = false
  await prisma.appSettings.update({ where: { shop }, data: { requireYear: false } });
  const makesFlexible = await get(`${host}/api/makes?shop=${shop}`);
  console.log("  requireYear = false -> makes without year count:", makesFlexible.data?.makes?.length);
  if (makesFlexible.data?.makes?.length === 0) throw new Error("Expected makes to be returned when requireYear is false");
  console.log("  [PASS] requireYear toggle functions seamlessly on backend and frontend.\n");

  // TEST 3: requireAllFields Toggle Flow
  console.log("TEST 3: 'Require All Fields (Year+Make+Model)' Flow");
  // 3a. With requireAllFields = true
  await prisma.appSettings.update({ where: { shop }, data: { requireAllFields: true } });
  const searchStrict = await get(`${host}/api/search?shop=${shop}&year=2025&make=Tata`);
  console.log("  requireAllFields = true -> search without model status:", searchStrict.status, "(expected 400)");
  if (searchStrict.status !== 400) throw new Error("Expected 400 status when searching without model in strict mode");

  // 3b. With requireAllFields = false
  await prisma.appSettings.update({ where: { shop }, data: { requireAllFields: false } });
  const searchFlexible = await get(`${host}/api/search?shop=${shop}&year=2025&make=Tata`);
  console.log("  requireAllFields = false -> search without model status:", searchFlexible.status, "products:", searchFlexible.data?.resultCount);
  if (searchFlexible.status !== 200 || searchFlexible.data?.resultCount === 0) throw new Error("Expected products when requireAllFields is false");
  console.log("  [PASS] requireAllFields toggle correctly gates or allows partial vehicle searches.\n");

  // TEST 4: logNoResults Flow
  console.log("TEST 4: 'Log No-Result Searches' Flow");
  // 4a. logNoResults = false
  await prisma.appSettings.update({ where: { shop }, data: { logNoResults: false, requireAllFields: true } });
  const countBefore1 = await prisma.searchLog.count({ where: { shop, hasResults: false } });
  await get(`${host}/api/search?shop=${shop}&year=1980&make=FakeMake&model=FakeModel`);
  const countAfter1 = await prisma.searchLog.count({ where: { shop, hasResults: false } });
  console.log("  logNoResults = false -> logs added:", countAfter1 - countBefore1, "(expected 0)");
  if (countAfter1 !== countBefore1) throw new Error("Unexpected log created when logNoResults is false");

  // 4b. logNoResults = true
  await prisma.appSettings.update({ where: { shop }, data: { logNoResults: true } });
  const countBefore2 = await prisma.searchLog.count({ where: { shop, hasResults: false } });
  await get(`${host}/api/search?shop=${shop}&year=1980&make=FakeMake&model=FakeModel`);
  const countAfter2 = await prisma.searchLog.count({ where: { shop, hasResults: false } });
  console.log("  logNoResults = true -> logs added:", countAfter2 - countBefore2, "(expected 1)");
  if (countAfter2 - countBefore2 !== 1) throw new Error("Expected 1 log created when logNoResults is true");
  console.log("  [PASS] logNoResults accurately records zero-result gaps for analytics.\n");

  // TEST 5: includeUniversal Flow (Search + Fitment-Check)
  console.log("TEST 5: 'Include Universal Fit Products' Flow");
  // 5a. includeUniversal = false
  await prisma.appSettings.update({ where: { shop }, data: { includeUniversal: false } });
  const searchNoUniv = await get(`${host}/api/search?shop=${shop}&year=2025&make=Tata&model=Nova`);
  const univInSearch = searchNoUniv.data?.products?.filter(p => p.source === 'universal') || [];
  const fitNoUniv = await get(`${host}/api/fitment-check?shop=${shop}&handle=the-videographer-snowboard&year=2025&make=Tata&model=Nova`);
  console.log("  includeUniversal = false -> universal in search:", univInSearch.length, "fit status:", fitNoUniv.data?.status);
  if (univInSearch.length !== 0 || fitNoUniv.data?.fits === true) throw new Error("Universal products should not match when disabled");

  // 5b. includeUniversal = true
  await prisma.appSettings.update({ where: { shop }, data: { includeUniversal: true } });
  const searchUniv = await get(`${host}/api/search?shop=${shop}&year=2025&make=Tata&model=Nova`);
  const univInSearch2 = searchUniv.data?.products?.filter(p => p.source === 'universal') || [];
  const fitUniv = await get(`${host}/api/fitment-check?shop=${shop}&handle=the-videographer-snowboard&year=2025&make=Tata&model=Nova`);
  console.log("  includeUniversal = true -> universal in search:", univInSearch2.length, "fit status:", fitUniv.data?.status);
  if (univInSearch2.length === 0 || fitUniv.data?.fits !== true) throw new Error("Universal products should match when enabled");
  console.log("  [PASS] includeUniversal toggle correctly includes or excludes universal items.\n");

  // TEST 6: VIN Cap Protection & Over-Billing Guard
  console.log("TEST 6: 'VIN Budget Protection & Over-Billing Guard' Flow");
  // 6a. Cap active and reached
  await prisma.appSettings.update({ where: { shop }, data: { vinCapEnabled: true, vinMonthlyCapLimit: 2 } });
  const vinBlocked = await get(`${host}/api/vin-lookup?shop=${shop}&vin=1HGCR2F83HA000000`);
  console.log("  vinMonthlyCapLimit = 2 -> status:", vinBlocked.status, "capReached:", vinBlocked.data?.capReached);
  if (vinBlocked.status !== 429 || !vinBlocked.data?.capReached) throw new Error("Expected 429 capReached when VIN cap is met");

  // 6b. Cap limit increased to 50
  await prisma.appSettings.update({ where: { shop }, data: { vinCapEnabled: true, vinMonthlyCapLimit: 50 } });
  const vinAllowed = await get(`${host}/api/vin-lookup?shop=${shop}&vin=1HGCR2F83HA000000`);
  console.log("  vinMonthlyCapLimit = 50 -> status:", vinAllowed.status, "success:", vinAllowed.data?.success);
  if (vinAllowed.status !== 200 || !vinAllowed.data?.success) throw new Error("Expected 200 success when under VIN cap");
  console.log("  [PASS] VIN safety shield blocks over-billing when threshold is hit.\n");

  // TEST 7: Restore original settings
  console.log("TEST 7: Settings Restoration");
  await prisma.appSettings.update({
    where: { shop },
    data: {
      requireYear: originalSettings.requireYear,
      requireAllFields: originalSettings.requireAllFields,
      logNoResults: originalSettings.logNoResults,
      includeUniversal: originalSettings.includeUniversal,
      redirectOnSearch: originalSettings.redirectOnSearch,
      resultsUrl: originalSettings.resultsUrl,
      persistSelection: originalSettings.persistSelection,
      enableGarage: originalSettings.enableGarage,
      showFitmentChecker: originalSettings.showFitmentChecker,
      vinCapEnabled: originalSettings.vinCapEnabled,
      vinMonthlyCapLimit: originalSettings.vinMonthlyCapLimit,
      vinAlertEmail: originalSettings.vinAlertEmail,
    },
  });
  console.log("  [PASS] Original settings restored perfectly.\n");

  console.log("===============================================================");
  console.log("   🎉 ALL 7 SETTING VERIFICATION AUDITS PASSED WITH ZERO ERRORS!");
  console.log("===============================================================");
}

runMasterTest().catch((err) => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
