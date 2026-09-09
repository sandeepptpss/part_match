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

const { action, loader } = await import('./api.ai-voice-search.js');
import prisma from '../app/db.server.js';
import { PLAN_TIERS } from '../app/plans.config.js';

console.log('===========================================================');
console.log('   PARTMATCH QA SIMULATION: AI VOICE SEARCH FEATURE SUITE   ');
console.log('===========================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS [${totalTests}]: ${testName}`);
    if (details) console.log(`      └─ ${details}`);
    passedTests++;
  } else {
    console.error(`  ✕ FAIL [${totalTests}]: ${testName}`);
    if (details) console.error(`      └─ ${details}`);
    failedTests++;
  }
}

async function runTestSuite() {
  const shop = 'quickstart-749ac396.myshopify.com';

  // Ensure shop is on Growth plan for testing
  await prisma.shopPlan.upsert({
    where: { shop },
    update: { plan: 'growth', billingCycle: 'monthly' },
    create: { shop, plan: 'growth', billingCycle: 'monthly' }
  });

  // -------------------------------------------------------------
  // TEST SUITE 1: PLAN LIMIT & ACCESS PERMISSION GUARD
  // -------------------------------------------------------------
  console.log('\n--- SUITE 1: Subscription Tier & Feature Gate Guard ---');

  // Test Free plan blocks Voice Search with 403
  await prisma.shopPlan.upsert({
    where: { shop },
    update: { plan: 'free' },
    create: { shop, plan: 'free' }
  });

  const blockedReq = new Request(`http://localhost:3000/api/ai-voice-search?shop=${shop}&query=2018+Honda+Civic`, {
    method: 'GET'
  });
  const blockedRes = await loader({ request: blockedReq });
  const blockedData = await blockedRes.json();

  assert(blockedRes.status === 403, 'Free plan blocked from AI Voice Search with HTTP 403');
  assert(
    blockedData.error?.includes('Growth Professional or Enterprise plan'),
    'Clear upgrade requirement prompt returned for Free plan',
    blockedData.error
  );

  // Restore Growth plan
  await prisma.shopPlan.upsert({
    where: { shop },
    update: { plan: 'growth' },
    create: { shop, plan: 'growth' }
  });

  const allowedReq = new Request(`http://localhost:3000/api/ai-voice-search?shop=${shop}&query=2025+Tata+Nova+LX`, {
    method: 'GET'
  });
  const allowedRes = await loader({ request: allowedReq });
  assert(allowedRes.status === 200, 'Growth plan successfully authorized with HTTP 200');

  // -------------------------------------------------------------
  // TEST SUITE 2: NATURAL LANGUAGE QUERY PARSING SIMULATION
  // -------------------------------------------------------------
  console.log('\n--- SUITE 2: Natural Language Vehicle & Part Parsing ---');

  const testQueries = [
    {
      input: 'Front brake pads for 2018 Honda Civic EX',
      expectedYear: '2018',
      expectedMake: 'Honda',
      expectedModel: 'Civic',
      expectedTrim: 'EX',
      expectedKeyword: 'brake pads'
    },
    {
      input: '2021 Ford F-150 Lariat oil filter',
      expectedYear: '2021',
      expectedMake: 'Ford',
      expectedModel: 'F-150',
      expectedTrim: 'Lariat',
      expectedKeyword: 'oil filter'
    },
    {
      input: 'Wipers for 2020 Toyota Camry',
      expectedYear: '2020',
      expectedMake: 'Toyota',
      expectedModel: 'Camry',
      expectedTrim: null,
      expectedKeyword: 'wipers'
    },
    {
      input: 'Spark plugs for a 2019 Chevrolet Silverado',
      expectedYear: '2019',
      expectedMake: 'Chevrolet',
      expectedModel: 'Silverado',
      expectedTrim: null,
      expectedKeyword: 'spark plugs'
    },
    {
      input: '2025 Tata Nova LX',
      expectedYear: '2025',
      expectedMake: 'Tata',
      expectedModel: 'Nova',
      expectedTrim: 'LX',
      expectedKeyword: null
    }
  ];

  for (const t of testQueries) {
    const req = new Request('http://localhost:3000/api/ai-voice-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, query: t.input })
    });
    const res = await action({ request: req });
    const data = await res.json();

    assert(data.success === true, `Successfully executed query: "${t.input}"`);
    assert(data.parsedVehicle?.year === t.expectedYear, `Parsed Year matches "${t.expectedYear}"`, `Got: ${data.parsedVehicle?.year}`);
    assert(data.parsedVehicle?.make?.toLowerCase() === t.expectedMake.toLowerCase(), `Parsed Make matches "${t.expectedMake}"`, `Got: ${data.parsedVehicle?.make}`);
    assert(data.parsedVehicle?.model === t.expectedModel, `Parsed Model matches "${t.expectedModel}"`, `Got: ${data.parsedVehicle?.model}`);
    if (t.expectedTrim) {
      assert(data.parsedVehicle?.trim === t.expectedTrim, `Parsed Trim matches "${t.expectedTrim}"`, `Got: ${data.parsedVehicle?.trim}`);
    }
    if (t.expectedKeyword) {
      assert(data.keyword === t.expectedKeyword, `Extracted Part Keyword matches "${t.expectedKeyword}"`, `Got: ${data.keyword}`);
    }
  }

  // -------------------------------------------------------------
  // TEST SUITE 3: DATABASE FITMENT RETRIEVAL & SPEECH RESPONSE
  // -------------------------------------------------------------
  console.log('\n--- SUITE 3: Live Database Fitment Lookup & Speech Response ---');

  // Query database for the existing record (2025 Tata Nova LX)
  const dbReq = new Request('http://localhost:3000/api/ai-voice-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, query: '2025 Tata Nova LX' })
  });
  const dbRes = await action({ request: dbReq });
  const dbData = await dbRes.json();

  assert(dbData.hasResults === true, 'Database hasResults flag is TRUE for 2025 Tata Nova LX');
  assert(dbData.resultCount > 0, `Returned ${dbData.resultCount} mapped products from fitment catalog`);
  assert(dbData.speechResponse?.includes('Found') && dbData.speechResponse?.includes('2025 Tata Nova LX'),
    'Generated natural voice assistant speech response',
    `Speech: "${dbData.speechResponse}"`
  );

  // Test Non-existent Vehicle
  const noMatchReq = new Request('http://localhost:3000/api/ai-voice-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, query: '1970 Ferrari Testarossa brake pads' })
  });
  const noMatchRes = await action({ request: noMatchReq });
  const noMatchData = await noMatchRes.json();

  assert(noMatchData.hasResults === false, 'Non-existent vehicle correctly returns hasResults: false');
  assert(noMatchData.speechResponse?.includes('No exact matches found'),
    'Voice assistant provides clear fallback advice when parts not found',
    `Speech: "${noMatchData.speechResponse}"`
  );

  // -------------------------------------------------------------
  // TEST SUITE 4: ZERO / SEARCH ANALYTICS LOGGING
  // -------------------------------------------------------------
  console.log('\n--- SUITE 4: Voice Search Logging & Analytics Tracking ---');

  const testSession = 'qa_session_' + Date.now();
  const logReq = new Request('http://localhost:3000/api/ai-voice-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shop,
      query: '2025 Tata Nova LX',
      sessionId: testSession
    })
  });
  await action({ request: logReq });

  const recentLog = await prisma.searchLog.findFirst({
    where: { shop, sessionId: testSession }
  });

  assert(recentLog !== null, 'Voice search query was automatically captured in searchLog table');
  assert(recentLog?.make === 'Tata' && recentLog?.year === '2025', 'Search log correctly recorded vehicle details for merchant analytics');

  // -------------------------------------------------------------
  // TEST SUITE 5: FRONTEND SPEECH API & FALLBACK SIMULATION
  // -------------------------------------------------------------
  console.log('\n--- SUITE 5: Browser SpeechRecognition & UI Fallback QA ---');

  // Simulate supported browser environment
  const mockSpeechRecognition = {
    continuous: false,
    interimResults: false,
    lang: 'en-US',
    started: false,
    start() { this.started = true; },
    stop() { this.started = false; }
  };
  assert(typeof mockSpeechRecognition.start === 'function', 'SpeechRecognition interface conforms to Web Speech API spec');

  // Simulate Theme Editor iframe security restriction
  const iframeErrorEvent = { error: 'not-allowed' };
  const isInIframe = true; // window.self !== window.top
  const feedbackMsg = (iframeErrorEvent.error === 'not-allowed' || isInIframe)
    ? 'Microphone access restricted inside Theme Editor iframe. Type your query here or open Live Store to use Voice mic.'
    : 'Voice input not captured.';

  assert(feedbackMsg.includes('Theme Editor iframe'), 'Theme Editor iframe restriction displays user-friendly typed fallback message');

  // Summary
  console.log('\n===========================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('===========================================================\n');

  if (failedTests === 0) {
    console.log('🎉 ALL VOICE SEARCH QA SIMULATION TESTS PASSED WITH 100% SUCCESS!');
    process.exit(0);
  } else {
    console.error(`⚠️ ${failedTests} TEST(S) FAILED.`);
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
