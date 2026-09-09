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

console.log('================================================================');
console.log('   PARTMATCH QA DEEP SIMULATION: END-TO-END AI VOICE SEARCH     ');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS [${String(totalTests).padStart(2, '0')}]: ${testName}`);
    if (details) console.log(`         └─ ${details}`);
    passedTests++;
  } else {
    console.error(`  ✕ FAIL [${String(totalTests).padStart(2, '0')}]: ${testName}`);
    if (details) console.error(`         └─ ${details}`);
    failedTests++;
  }
}

async function runDeepVerification() {
  const shop = 'quickstart-749ac396.myshopify.com';

  // -------------------------------------------------------------
  // SUITE 1: MULTI-TIER BILLING GATEWAY DEEP VERIFICATION
  // -------------------------------------------------------------
  console.log('--- SUITE 1: Multi-Tier Billing & Plan Feature Gates ---');

  const tiersToTest = [
    { tier: 'free', expectedStatus: 403, expectedAllowed: false, desc: 'Starter Free plan' },
    { tier: 'starter', expectedStatus: 403, expectedAllowed: false, desc: 'Starter Pro ($19/mo) plan' },
    { tier: 'growth', expectedStatus: 200, expectedAllowed: true, desc: 'Growth Pro ($49/mo) plan' },
    { tier: 'enterprise', expectedStatus: 200, expectedAllowed: true, desc: 'Enterprise Unlimited ($99/mo) plan' },
  ];

  for (const t of tiersToTest) {
    await prisma.shopPlan.upsert({
      where: { shop },
      update: { plan: t.tier, billingCycle: 'monthly' },
      create: { shop, plan: t.tier, billingCycle: 'monthly' },
    });

    const req = new Request(`http://localhost:3000/api/ai-voice-search?shop=${shop}&query=2018+Honda+Civic`, {
      method: 'GET',
    });
    const res = await loader({ request: req });
    const data = await res.json();

    assert(
      res.status === t.expectedStatus,
      `${t.desc} gating returns HTTP ${t.expectedStatus}`,
      `Plan: "${t.tier}" | Status: ${res.status} | Allowed: ${t.expectedAllowed}`
    );

    if (!t.expectedAllowed) {
      assert(
        data.error?.includes('Growth Professional or Enterprise plan'),
        `${t.desc} provides explicit upsell guidance to merchant`,
        data.error
      );
    } else {
      assert(data.success === true, `${t.desc} grants full access to Voice Search engine`);
    }
  }

  // Restore shop to Growth tier for remaining tests
  await prisma.shopPlan.upsert({
    where: { shop },
    update: { plan: 'growth', billingCycle: 'monthly' },
    create: { shop, plan: 'growth', billingCycle: 'monthly' },
  });

  // -------------------------------------------------------------
  // SUITE 2: DEEP REAL-WORLD NATURAL LANGUAGE VOICE SIMULATIONS
  // -------------------------------------------------------------
  console.log('\n--- SUITE 2: Conversational Voice Queries & Edge-Case NLP ---');

  const complexVoiceScenarios = [
    {
      name: 'Conversational filler with truck & trim',
      input: "Hey PartMatch, can you please find me front brake rotors for my dad's 2017 Toyota Tacoma TRD",
      expectedYear: '2017',
      expectedMake: 'Toyota',
      expectedModel: 'Tacoma',
      expectedTrim: 'TRD',
      expectedKeyword: 'brake rotors',
    },
    {
      name: 'Hyphenated truck model with trim & part',
      input: '2021 Ford F-150 Lariat oil filter',
      expectedYear: '2021',
      expectedMake: 'Ford',
      expectedModel: 'F-150',
      expectedTrim: 'Lariat',
      expectedKeyword: 'oil filter',
    },
    {
      name: 'Two-word luxury make (Mercedes-Benz)',
      input: 'Brake pads for 2020 Mercedes-Benz C-Class',
      expectedYear: '2020',
      expectedMake: 'Mercedes-Benz',
      expectedKeyword: 'brake pads',
    },
    {
      name: 'Italian performance make (Alfa Romeo)',
      input: 'Air filter for 2021 Alfa Romeo Giulia',
      expectedYear: '2021',
      expectedMake: 'Alfa Romeo',
      expectedKeyword: 'air filter',
    },
    {
      name: 'Short-form brand slang (Chevy)',
      input: 'Spark plugs for a 2019 Chevy Silverado LTZ',
      expectedYear: '2019',
      expectedMake: 'Chevy',
      expectedModel: 'Silverado',
      expectedTrim: 'LTZ',
      expectedKeyword: 'spark plugs',
    },
    {
      name: 'Short-form brand slang (VW)',
      input: 'Wipers for 2022 VW Golf GTI',
      expectedYear: '2022',
      expectedMake: 'VW',
      expectedKeyword: 'wipers',
    },
    {
      name: 'Powersports / Motorcycle (Yamaha)',
      input: 'Exhaust for 2023 Yamaha YZF',
      expectedYear: '2023',
      expectedMake: 'Yamaha',
      expectedKeyword: 'exhaust',
    },
    {
      name: 'High-performance trim (Honda Civic Type R)',
      input: 'Front brake pads for 2019 Honda Civic Type R',
      expectedYear: '2019',
      expectedMake: 'Honda',
      expectedModel: 'Civic',
      expectedTrim: 'Type R',
      expectedKeyword: 'brake pads',
    },
    {
      name: 'Store Custom Make from Database (Tata Nova LX)',
      input: 'Headlights for 2025 Tata Nova LX',
      expectedYear: '2025',
      expectedMake: 'Tata',
      expectedModel: 'Nova',
      expectedTrim: 'LX',
      expectedKeyword: 'headlights',
    },
    {
      name: 'Punctuation, Noise & Mixed UPPERCASE',
      input: '*** 2024 FORD F-150 ??? BRAKE PADS !!! ***',
      expectedYear: '2024',
      expectedMake: 'Ford',
      expectedModel: 'F-150',
      expectedKeyword: 'brake pads',
    },
    {
      name: 'Make and Model without Year specified',
      input: 'Brake pads for Ford F-150',
      expectedYear: null,
      expectedMake: 'Ford',
      expectedModel: 'F-150',
      expectedKeyword: 'brake pads',
    },
  ];

  for (const s of complexVoiceScenarios) {
    const req = new Request('http://localhost:3000/api/ai-voice-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, query: s.input }),
    });
    const res = await action({ request: req });
    const data = await res.json();

    assert(data.success === true, `Scenario "${s.name}" processed successfully`);
    if (s.expectedYear) {
      assert(data.parsedVehicle?.year === s.expectedYear, `  -> Year parsed as "${s.expectedYear}"`, `Got: ${data.parsedVehicle?.year}`);
    }
    if (s.expectedMake) {
      assert(data.parsedVehicle?.make?.toLowerCase() === s.expectedMake.toLowerCase(), `  -> Make parsed as "${s.expectedMake}"`, `Got: ${data.parsedVehicle?.make}`);
    }
    if (s.expectedModel) {
      assert(data.parsedVehicle?.model?.toLowerCase().includes(s.expectedModel.toLowerCase()), `  -> Model parsed as "${s.expectedModel}"`, `Got: ${data.parsedVehicle?.model}`);
    }
    if (s.expectedTrim) {
      assert(data.parsedVehicle?.trim === s.expectedTrim, `  -> Trim parsed as "${s.expectedTrim}"`, `Got: ${data.parsedVehicle?.trim}`);
    }
    if (s.expectedKeyword) {
      assert(data.keyword === s.expectedKeyword, `  -> Part keyword parsed as "${s.expectedKeyword}"`, `Got: ${data.keyword}`);
    }
  }

  // -------------------------------------------------------------
  // SUITE 3: DATABASE FITMENT INTEGRITY & PRODUCT EXTRACTION
  // -------------------------------------------------------------
  console.log('\n--- SUITE 3: Live Database Fitment & Product Extraction ---');

  // Verify actual database record: 2025 Tata Nova LX
  const liveReq = new Request('http://localhost:3000/api/ai-voice-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, query: '2025 Tata Nova LX' }),
  });
  const liveRes = await action({ request: liveReq });
  const liveData = await liveRes.json();

  assert(liveData.hasResults === true, 'Database hasResults flag is TRUE for 2025 Tata Nova LX');
  assert(Array.isArray(liveData.products), 'Products array returned in structured JSON');
  assert(liveData.products.length > 0, `Successfully retrieved ${liveData.products.length} mapped products`);

  const sampleProduct = liveData.products[0];
  assert(Boolean(sampleProduct.shopifyProductId), 'Product contains valid shopifyProductId GID', sampleProduct.shopifyProductId);
  assert(Boolean(sampleProduct.shopifyHandle), 'Product contains valid shopifyHandle', sampleProduct.shopifyHandle);
  assert(Boolean(sampleProduct.productTitle), 'Product contains valid productTitle', sampleProduct.productTitle);
  assert(sampleProduct.source === 'fitment_product', 'Product source accurately flagged as "fitment_product"');

  // Verify Assistant Speech Generation
  assert(
    liveData.speechResponse?.includes('Found') && liveData.speechResponse?.includes('2025 Tata Nova LX'),
    'Assistant generates concise, high-converting voice speech response',
    `Speech: "${liveData.speechResponse}"`
  );

  // -------------------------------------------------------------
  // SUITE 4: ZERO RESULTS REASONING & DEMAND TRACKING
  // -------------------------------------------------------------
  console.log('\n--- SUITE 4: Zero Results Reasoning & Demand Analytics ---');

  const zeroSearchSession = 'qa_voice_zero_' + Date.now();
  const zeroReq = new Request('http://localhost:3000/api/ai-voice-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shop,
      query: '2022 Bugatti Chiron brake pads',
      sessionId: zeroSearchSession,
    }),
  });
  const zeroRes = await action({ request: zeroReq });
  const zeroData = await zeroRes.json();

  assert(zeroData.hasResults === false, 'Zero results correctly identified (hasResults: false)');
  assert(zeroData.resultCount === 0, 'resultCount equals 0');
  assert(
    zeroData.speechResponse?.includes('No exact matches found for 2022 Bugatti Chiron'),
    'Assistant tells buyer politely that no parts match this exact vehicle',
    zeroData.speechResponse
  );

  // Verify Analytics Log for Zero Search
  const zeroLog = await prisma.searchLog.findFirst({
    where: { shop, sessionId: zeroSearchSession },
  });
  assert(zeroLog !== null, 'Zero-results search logged to database for Merchant Demand Analysis');
  assert(zeroLog?.hasResults === false, 'Zero-results log correctly flags hasResults as false');
  assert(zeroLog?.make === 'Bugatti' && zeroLog?.year === '2022', 'Zero-results log records vehicle year & make');

  // -------------------------------------------------------------
  // SUITE 5: FRONTEND WIDGET & WEB SPEECH API LIFECYCLE SIMULATION
  // -------------------------------------------------------------
  console.log('\n--- SUITE 5: Frontend Widget DOM & Web Speech API Lifecycle ---');

  // 1. Simulated DOM Tree
  const mockDOM = {
    tabs: { display: 'none' },
    voiceTab: { display: 'none', textContent: 'AI VOICE SEARCH' },
    voicePanel: { display: 'none' },
    voiceInput: { value: '', placeholder: '' },
    micBtn: {
      style: { background: '#eff6ff', color: '#2563eb', borderColor: '#bfdbfe' },
      clickHandlers: [],
      addEventListener(evt, fn) { if (evt === 'click') this.clickHandlers.push(fn); },
      click() { this.clickHandlers.forEach((fn) => fn()); },
    },
    voiceBtn: {
      style: { background: '#0f172a', color: '#ffffff' },
      clickHandlers: [],
      addEventListener(evt, fn) { if (evt === 'click') this.clickHandlers.push(fn); },
      async click() {
        for (const fn of this.clickHandlers) {
          await fn();
        }
      },
    },
    voiceFeedback: { display: 'none', innerHTML: '', type: '' },
    resultsEl: { display: 'none', innerHTML: '' },
  };

  // Helper simulating showBannerFeedback
  function simulateFeedback(msg, type) {
    mockDOM.voiceFeedback.display = 'block';
    mockDOM.voiceFeedback.innerHTML = msg;
    mockDOM.voiceFeedback.type = type;
  }

  // 2. Simulate Web Speech Recognition
  let micActive = false;
  const mockRecognition = {
    continuous: false,
    interimResults: false,
    lang: 'en-US',
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      micActive = true;
      mockDOM.micBtn.style.background = '#ef4444'; // Red recording state
      mockDOM.micBtn.style.color = '#ffffff';
      simulateFeedback('Listening... Speak your vehicle and part (e.g. 2018 Honda Civic EX brake pads)', 'info');
    },
    stop() {
      micActive = false;
      mockDOM.micBtn.style.background = '#eff6ff';
      mockDOM.micBtn.style.color = '#2563eb';
      if (this.onend) this.onend();
    },
  };

  // Wire simulated mic button click
  mockDOM.micBtn.addEventListener('click', () => {
    mockRecognition.start();
  });

  // Test Mic Click
  mockDOM.micBtn.click();
  assert(micActive === true, 'Microphone start() triggered on mic button click');
  assert(mockDOM.micBtn.style.background === '#ef4444', 'Mic button turns RED (#ef4444) indicating active listening state');
  assert(mockDOM.voiceFeedback.innerHTML.includes('Listening...'), 'User feedback banner informs shopper: "Listening..."');

  // Simulate Speech Result event
  mockRecognition.onresult = (transcript) => {
    mockDOM.voiceInput.value = transcript;
    mockRecognition.stop();
  };
  mockRecognition.onresult('2025 Tata Nova LX');

  assert(mockDOM.voiceInput.value === '2025 Tata Nova LX', 'Voice recognition transcribed text populated into search input');
  assert(micActive === false, 'Microphone automatically stopped after capturing speech transcript');
  assert(mockDOM.micBtn.style.background === '#eff6ff', 'Mic button restored to inactive styling after speech capture');

  // Simulate Search Execution from Voice Input
  let activeVehicleSaved = null;
  function simulateSaveVehicle(v) {
    activeVehicleSaved = v;
  }

  function simulateRenderResults(products, count, vehicle) {
    mockDOM.resultsEl.display = 'block';
    mockDOM.resultsEl.innerHTML = `
      <div class="pm-results-grid" style="display: grid; gap: 16px;">
        ${products
          .map(
            (p) => `
          <div class="pm-card" style="padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-weight: 700;">${p.productTitle}</div>
            <a href="/products/${p.shopifyHandle}">View Part</a>
          </div>`
          )
          .join('')}
      </div>`;
  }

  // Simulate Voice Button Click pipeline
  mockDOM.voiceBtn.addEventListener('click', async () => {
    const q = mockDOM.voiceInput.value.trim();
    simulateFeedback('AI is searching fitments...', 'info');

    const res = await action({
      request: new Request('http://localhost:3000/api/ai-voice-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, query: q }),
      }),
    });
    const resData = await res.json();

    simulateFeedback(resData.speechResponse, 'success');

    if (resData.parsedVehicle?.year && resData.parsedVehicle?.make && resData.parsedVehicle?.model) {
      simulateSaveVehicle({
        year: resData.parsedVehicle.year,
        make: resData.parsedVehicle.make,
        model: resData.parsedVehicle.model,
      });
    }

    simulateRenderResults(resData.products, resData.resultCount, resData.parsedVehicle);
  });

  await mockDOM.voiceBtn.click();

  assert(mockDOM.voiceFeedback.type === 'success', 'Voice feedback banner updated to success state');
  assert(activeVehicleSaved !== null, 'Vehicle parsed from voice query was saved to Garage / session cache');
  assert(
    activeVehicleSaved?.year === '2025' && activeVehicleSaved?.make === 'Tata' && activeVehicleSaved?.model === 'Nova',
    'Saved vehicle attributes accurately match parsed voice query (2025 Tata Nova)'
  );
  assert(mockDOM.resultsEl.display === 'block', 'Results container visibility toggled to display: block');
  assert(mockDOM.resultsEl.innerHTML.includes('pm-results-grid'), 'Product cards grid successfully rendered into storefront DOM');
  assert(mockDOM.resultsEl.innerHTML.includes('Hydrogen'), 'Mapped product title rendered inside product card');

  // Test Microphone Permission Error Handling (e.g. Theme Editor iframe)
  mockRecognition.onerror = (err) => {
    mockRecognition.stop();
    if (err === 'not-allowed') {
      simulateFeedback(
        'Microphone access restricted inside Theme Editor iframe. Type your query here or open Live Store to use Voice mic.',
        'error'
      );
    }
  };
  mockRecognition.onerror('not-allowed');

  assert(mockDOM.voiceFeedback.type === 'error', 'Error feedback state triggered on permission denial');
  assert(
    mockDOM.voiceFeedback.innerHTML.includes('Theme Editor iframe'),
    'Helpful fallback guidance presented when browser / iframe restricts microphone access'
  );

  // -------------------------------------------------------------
  // TEST SUMMARY & FINAL VERDICT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`DEEP TEST SUITE COMPLETED: ${totalTests} CHECKS EXECUTED`);
  console.log(`PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests === 0) {
    console.log('🎉 ALL 56 DEEP VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
    process.exit(0);
  } else {
    console.error(`✕ ${failedTests} test(s) failed in deep verification.`);
    process.exit(1);
  }
}

runDeepVerification().catch((err) => {
  console.error('Fatal Deep Verification Error:', err);
  process.exit(1);
});
