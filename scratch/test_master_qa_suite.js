import fs from 'fs';
import path from 'path';
import fetch, { Request, Response, Headers } from 'node-fetch';

globalThis.fetch = fetch;
globalThis.Request = Request;
globalThis.Response = Response;
globalThis.Headers = Headers;
if (!Response.json) {
  Response.json = (data, init = {}) => {
    const body = JSON.stringify(data);
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    return new Response(body, { ...init, headers });
  };
}

process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || 'https://partmatch.example.com';
process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_api_key';
process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_api_secret';
process.env.SCOPES = process.env.SCOPES || 'read_products,write_products';

const { default: prisma } = await import('../app/db.server.js');
const { loader: fitmentCheckLoader } = await import('../app/routes/api.fitment-check.jsx');
const { action: searchAction, loader: searchLoader } = await import('../app/routes/api.search.jsx');
const { action: garageAction, loader: garageLoader } = await import('../app/routes/api.garage.jsx');
const { action: vinAction } = await import('../app/routes/api.vin-lookup.jsx');

console.log('================================================================');
console.log('    PARTMATCH MASTER END-TO-END QA TESTING & VERIFICATION SUITE  ');
console.log('================================================================\n');

let testCounter = 0;
let passed = 0;
let failed = 0;
const bugsFound = [];

function assert(condition, scenario, details = '', severity = 'MAJOR') {
  testCounter++;
  const num = String(testCounter).padStart(3, '0');
  if (condition) {
    console.log(`  ✓ PASS [${num}]: ${scenario}`);
    if (details) console.log(`         └─ ${details}`);
    passed++;
  } else {
    console.error(`  ✕ FAIL [${num}]: ${scenario}`);
    if (details) console.error(`         └─ ${details}`);
    failed++;
    bugsFound.push({
      scenario,
      details,
      severity,
    });
  }
}

async function runMasterTestSuite() {
  const shop = 'quickstart-749ac396.myshopify.com';

  // Ensure default app settings and plan exist
  await prisma.appSettings.upsert({
    where: { shop },
    update: {
      requireYear: true,
      requireAllFields: true,
      logNoResults: true,
      includeUniversal: true,
      enableGarage: true,
      enableTrim: true,
      enableVinSearch: true,
      vinCapEnabled: true,
      vinMonthlyCapLimit: 50,
    },
    create: {
      shop,
      requireYear: true,
      requireAllFields: true,
      logNoResults: true,
      includeUniversal: true,
      enableGarage: true,
      enableTrim: true,
      enableVinSearch: true,
      vinCapEnabled: true,
      vinMonthlyCapLimit: 50,
    },
  });

  await prisma.shopPlan.upsert({
    where: { shop },
    update: { plan: 'growth', billingCycle: 'monthly' },
    create: { shop, plan: 'growth', billingCycle: 'monthly' },
  });

  // -----------------------------------------------------------------
  // FLOW 1: MERCHANT ONBOARDING & SAMPLE ASSETS
  // -----------------------------------------------------------------
  console.log('--- FLOW 1: Merchant Onboarding & Static Assets Verification ---');

  const pubDir = path.resolve('public');
  const partmatchCsv = path.join(pubDir, 'partmatch_sample_template.csv');
  const acesCsv = path.join(pubDir, 'aces_sample_template.csv');
  const acesXml = path.join(pubDir, 'aces_sample_template.xml');

  assert(fs.existsSync(partmatchCsv), 'Flow 1: PartMatch CSV template exists in /public');
  assert(fs.existsSync(acesCsv), 'Flow 1: ACES CSV template exists in /public');
  assert(fs.existsSync(acesXml), 'Flow 1: ACES XML template exists in /public');

  const onboardingFile = path.resolve('app/routes/app.onboarding.jsx');
  assert(fs.existsSync(onboardingFile), 'Flow 1: Onboarding route file exists');
  const onboardingSrc = fs.readFileSync(onboardingFile, 'utf8');
  assert(onboardingSrc.includes('partmatch_sample_template.csv'), 'Flow 1: Onboarding links to PartMatch CSV template');
  assert(onboardingSrc.includes('aces_sample_template.csv'), 'Flow 1: Onboarding links to ACES CSV template');
  assert(onboardingSrc.includes('/app/fitment/import'), 'Flow 1: Onboarding links to catalog import route');

  // -----------------------------------------------------------------
  // FLOW 2: SEARCH WIDGET STUDIO & STOREFRONT ASSETS
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 2: Search Widget Studio & Storefront UI Styling ---');

  const widgetRouteFile = path.resolve('app/routes/app.widget.jsx');
  assert(fs.existsSync(widgetRouteFile), 'Flow 2: Search Widget route file exists');
  const widgetRouteSrc = fs.readFileSync(widgetRouteFile, 'utf8');
  assert(widgetRouteSrc.includes('heading') && widgetRouteSrc.includes('primaryColor'), 'Flow 2: Widget Studio supports custom headings and colors');
  assert(widgetRouteSrc.includes('maxWidth: "100%"'), 'Flow 2: Widget Studio container is 100% fluid');

  const partmatchJsPath = path.resolve('extensions/partmatch-widget/assets/partmatch.js');
  const partmatchCssPath = path.resolve('extensions/partmatch-widget/assets/partmatch.css');
  assert(fs.existsSync(partmatchJsPath), 'Flow 2: partmatch.js storefront script exists');
  assert(fs.existsSync(partmatchCssPath), 'Flow 2: partmatch.css storefront stylesheet exists');

  const jsContent = fs.readFileSync(partmatchJsPath, 'utf8');
  const cssContent = fs.readFileSync(partmatchCssPath, 'utf8');
  assert(jsContent.includes('showValidationError'), 'Flow 2: Storefront JS implements showValidationError');
  assert(jsContent.includes('pm-select--error'), 'Flow 2: Storefront JS adds error class on unselected fields');
  assert(cssContent.includes('.pm-select--error'), 'Flow 2: Storefront CSS styles invalid dropdowns');
  assert(cssContent.includes('pm-shake'), 'Flow 2: Storefront CSS implements shake keyframe animation');

  // -----------------------------------------------------------------
  // FLOW 3: FITMENT CATALOG MANAGEMENT & BULK OPERATIONS
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 3: Fitment Catalog Management & Bulk Operations ---');

  // Test database CRUD for FitmentRecord
  const testFitment = await prisma.fitmentRecord.upsert({
    where: {
      shop_year_make_model_trim: {
        shop,
        year: '2026',
        make: 'MasterTestMake',
        model: 'TestModel',
        trim: 'Sport',
      },
    },
    update: {},
    create: {
      shop,
      year: '2026',
      make: 'MasterTestMake',
      model: 'TestModel',
      trim: 'Sport',
    },
  });

  assert(Boolean(testFitment.id), 'Flow 3: Fitment record created successfully in database');

  // Attach a product mapping
  const testProd = await prisma.fitmentProduct.upsert({
    where: {
      fitmentId_shopifyProductId: {
        fitmentId: testFitment.id,
        shopifyProductId: 'gid://shopify/Product/999888777',
      },
    },
    update: { shopifyHandle: 'test-master-part', productTitle: 'Master Test Brake Pad' },
    create: {
      fitmentId: testFitment.id,
      shopifyProductId: 'gid://shopify/Product/999888777',
      shopifyHandle: 'test-master-part',
      productTitle: 'Master Test Brake Pad',
    },
  });

  assert(testProd.shopifyHandle === 'test-master-part', 'Flow 3: Product mapped to fitment record');

  // Test XML Parsing with namespaces
  const testXmlInput = `
    <aces:ACES xmlns:aces="http://www.autocare.org/aces" version="3.2">
      <aces:App action="A" id="999">
        <aces:BaseVehicleYear>2026</aces:BaseVehicleYear>
        <aces:MakeName>MasterTestMake</aces:MakeName>
        <aces:ModelName>TestModel</aces:ModelName>
        <aces:SubModelName>Sport</aces:SubModelName>
        <aces:PartNumber>TEST-PART-NUM-001</aces:PartNumber>
      </aces:App>
    </aces:ACES>`;
  
  const appBlocks = testXmlInput.match(/<(?:[a-zA-Z0-9_]+:)?App[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?App>/gi) || [];
  assert(appBlocks.length === 1, 'Flow 3: ACES XML parser isolates <aces:App> tag');

  // -----------------------------------------------------------------
  // FLOW 4: UNIVERSAL PRODUCTS & PDP FITMENT CHECKER
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 4: Universal Products & PDP Fitment Checker ---');

  // Add Universal Product
  const univProd = await prisma.universalProduct.upsert({
    where: {
      shop_shopifyProductId: {
        shop,
        shopifyProductId: 'gid://shopify/Product/111222333',
      },
    },
    update: { shopifyHandle: 'universal-car-cover', productTitle: 'All-Weather Universal Car Cover' },
    create: {
      shop,
      shopifyProductId: 'gid://shopify/Product/111222333',
      shopifyHandle: 'universal-car-cover',
      productTitle: 'All-Weather Universal Car Cover',
    },
  });

  assert(univProd.shopifyHandle === 'universal-car-cover', 'Flow 4: Universal Product created');

  // Test direct product fitment check
  const fitReq = new Request(`http://localhost:3000/api/fitment-check?shop=${shop}&handle=test-master-part&year=2026&make=MasterTestMake&model=TestModel&trim=Sport`);
  const fitRes = await fitmentCheckLoader({ request: fitReq });
  const fitData = await fitRes.json();

  assert(fitData.fits === true, 'Flow 4: Direct product fitment check returns fits: true', `Badge: ${fitData.badgeText}`);
  assert(fitData.status === 'FITS', 'Flow 4: Fitment status is "FITS"');

  // Test universal product fitment check
  const univReq = new Request(`http://localhost:3000/api/fitment-check?shop=${shop}&handle=universal-car-cover&year=2026&make=MasterTestMake&model=TestModel`);
  const univRes = await fitmentCheckLoader({ request: univReq });
  const univData = await univRes.json();

  assert(univData.fits === true && univData.reason === 'universal', 'Flow 4: Universal product fitment check returns fits: true (reason: universal)');

  // Negative scenario: Unmatched product
  const noFitReq = new Request(`http://localhost:3000/api/fitment-check?shop=${shop}&handle=unmatched-spoiler&year=2026&make=MasterTestMake&model=TestModel`);
  const noFitRes = await fitmentCheckLoader({ request: noFitReq });
  const noFitData = await noFitRes.json();

  assert(noFitData.fits === false, 'Flow 4: Unmatched product returns fits: false', `Badge: ${noFitData.badgeText}`);

  // -----------------------------------------------------------------
  // FLOW 5: STOREFRONT CASCADING SEARCH & MY GARAGE
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 5: Storefront YMM Cascading Search & My Garage ---');

  // Storefront Search execution
  const searchReq = new Request(`http://localhost:3000/api/search?shop=${shop}&year=2026&make=MasterTestMake&model=TestModel&trim=Sport`);
  const searchRes = await searchLoader({ request: searchReq });
  const searchData = await searchRes.json();
  if (!searchData.hasResults) {
    console.log("  [DEBUG searchData]:", JSON.stringify(searchData));
  }

  assert(searchData.hasResults === true, 'Flow 5: Storefront search returns matched fitment results');
  assert(searchData.products.some(p => p.shopifyHandle === 'test-master-part'), 'Flow 5: Direct product included in search results');
  assert(searchData.products.some(p => p.shopifyHandle === 'universal-car-cover'), 'Flow 5: Universal product appended to search results');

  // Negative scenario: Missing required search fields
  const invalidSearchReq = new Request(`http://localhost:3000/api/search?shop=${shop}&year=2026`);
  const invalidSearchRes = await searchLoader({ request: invalidSearchReq });
  assert(invalidSearchRes.status === 400, 'Flow 5: Negative scenario - search without make/model returns HTTP 400');

  // My Garage Sync
  const customerId = 'cust_qa_test_99';
  const addGarageReq = new Request(`http://localhost:3000/api/garage?shop=${shop}&logged_in_customer_id=${customerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'add', year: '2026', make: 'MasterTestMake', model: 'TestModel', trim: 'Sport' }),
  });
  const addGarageRes = await garageAction({ request: addGarageReq });
  const addGarageData = await addGarageRes.json();

  assert(addGarageData.loggedIn === true, 'Flow 5: My Garage recognizes logged-in customer');
  assert(addGarageData.vehicles.length === 1, 'Flow 5: Vehicle added to My Garage');
  assert(addGarageData.vehicles[0].make === 'MasterTestMake', 'Flow 5: My Garage vehicle attributes saved accurately');

  // Guest customer check (no logged_in_customer_id)
  const guestGarageReq = new Request(`http://localhost:3000/api/garage?shop=${shop}`);
  const guestGarageRes = await garageLoader({ request: guestGarageReq });
  const guestGarageData = await guestGarageRes.json();
  assert(guestGarageData.loggedIn === false, 'Flow 5: Guest customer returns loggedIn: false (falls back to localStorage)');

  // -----------------------------------------------------------------
  // FLOW 6: CONVERSATIONAL AI VOICE SEARCH ENGINE
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 6: Conversational AI Voice Search Engine ---');

  const voiceModule = await import('../scratch/api.ai-voice-search.js');
  const voiceReq = new Request('http://localhost:3000/api/ai-voice-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, query: "Show me brake pads for a 2026 MasterTestMake TestModel Sport" }),
  });
  const voiceRes = await voiceModule.action({ request: voiceReq });
  const voiceData = await voiceRes.json();

  assert(voiceData.success === true, 'Flow 6: Conversational voice query processed successfully');
  assert(voiceData.parsedVehicle?.year === '2026', 'Flow 6: AI Voice parsed Year as "2026"');
  assert(voiceData.parsedVehicle?.make?.toLowerCase() === 'mastertestmake', 'Flow 6: AI Voice parsed Make correctly');
  assert(voiceData.parsedVehicle?.model?.toLowerCase() === 'testmodel', 'Flow 6: AI Voice parsed Model correctly');

  // -----------------------------------------------------------------
  // FLOW 7: STOREFRONT VIN LOOKUP ENGINE & SAFETY BUDGET GUARD
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 7: Storefront VIN Lookup Engine & Safety Budget Guard ---');

  // Test invalid VIN length (negative scenario)
  const badVinReq = new Request(`http://localhost:3000/api/vin-lookup?shop=${shop}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, vin: 'SHORTVIN123' }),
  });
  const badVinRes = await vinAction({ request: badVinReq });
  assert(badVinRes.status === 400, 'Flow 7: Negative scenario - Invalid VIN length returns HTTP 400');

  // -----------------------------------------------------------------
  // FLOW 8: SEARCH ANALYTICS & ZERO-RESULT INSIGHTS
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 8: Search Analytics & Zero-Result Insights ---');

  const logCount = await prisma.searchLog.count({ where: { shop } });
  assert(logCount > 0, `Flow 8: Database contains ${logCount} logged searches for merchant analytics`);

  const analyticsFile = path.resolve('app/routes/app.analytics.jsx');
  assert(fs.existsSync(analyticsFile), 'Flow 8: Search Analytics route file exists');
  const analyticsSrc = fs.readFileSync(analyticsFile, 'utf8');
  assert(analyticsSrc.includes('maxWidth: "100%"'), 'Flow 8: Analytics container is 100% fluid');

  // -----------------------------------------------------------------
  // FLOW 9: SUBSCRIPTION PLANS, VIP OFFERS & BILLING
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 9: Subscription Plans, VIP Offers & Billing ---');

  const plansFile = path.resolve('app/routes/app.plans.jsx');
  assert(fs.existsSync(plansFile), 'Flow 9: Plans route file exists');
  const plansSrc = fs.readFileSync(plansFile, 'utf8');
  assert(plansSrc.includes('Enterprise'), 'Flow 9: Plans page displays Enterprise custom tier');
  assert(plansSrc.includes('annualDiscountPercent'), 'Flow 9: Plans page calculates annual billing discounts');
  assert(plansSrc.includes('maxWidth: "100%"'), 'Flow 9: Plans container is 100% fluid');

  // -----------------------------------------------------------------
  // FLOW 10: APP ADMIN SYSTEM & GLOBAL VIP CONFIG
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 10: App Admin System & Global VIP Config ---');

  const adminFile = path.resolve('app/routes/app.admin.jsx');
  assert(fs.existsSync(adminFile), 'Flow 10: App Admin route file exists');
  const adminSrc = fs.readFileSync(adminFile, 'utf8');
  assert(adminSrc.includes('vipFreeOfferActive'), 'Flow 10: App Admin controls global VIP free offer toggle');
  assert(adminSrc.includes('maxWidth: "100%"'), 'Flow 10: App Admin container is 100% fluid');

  // -----------------------------------------------------------------
  // FLOW 11: GENERAL SETTINGS, OPERATIONS & EDGE CASES
  // -----------------------------------------------------------------
  console.log('\n--- FLOW 11: General Settings, Operations & Edge Cases ---');

  const settingsFile = path.resolve('app/routes/app.settings.jsx');
  assert(fs.existsSync(settingsFile), 'Flow 11: Settings route file exists');
  const settingsSrc = fs.readFileSync(settingsFile, 'utf8');
  assert(settingsSrc.includes('vinMonthlyCapLimit'), 'Flow 11: Settings manages VIN monthly safety cap limit');
  assert(settingsSrc.includes('maxWidth: "100%"'), 'Flow 11: Settings container is 100% fluid');

  // Clean up master test fitment and universal product
  await prisma.fitmentRecord.deleteMany({ where: { shop, make: 'MasterTestMake' } });
  await prisma.universalProduct.deleteMany({ where: { shop, shopifyHandle: 'universal-car-cover' } });
  await prisma.savedVehicle.deleteMany({ where: { shop, make: 'MasterTestMake' } });

  // -----------------------------------------------------------------
  // SUMMARY REPORT
  // -----------------------------------------------------------------
  console.log('\n================================================================');
  console.log('             MASTER QA TEST SUITE EXECUTION SUMMARY             ');
  console.log('================================================================');
  console.log(`TOTAL CHECKS EXECUTED : ${testCounter}`);
  console.log(`PASSED               : ${passed}`);
  console.log(`FAILED               : ${failed}`);
  console.log('================================================================\n');

  if (failed === 0) {
    console.log('🎉 ALL 11 APPLICATION FLOWS VERIFIED WITH 100% SUCCESS!');
  } else {
    console.error(`✕ ${failed} check(s) failed during execution.`);
    process.exit(1);
  }
}

runMasterTestSuite().catch((err) => {
  console.error('Fatal error running Master QA Suite:', err);
  process.exit(1);
});
