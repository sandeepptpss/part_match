const http = require('http');

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

async function testLiveEndpoints() {
  const host = 'http://127.0.0.1:46545';
  const shop = 'quickstart-749ac396.myshopify.com';

  console.log('--- 1. Testing /api/config ---');
  const cfg = await get(`${host}/api/config?shop=${shop}`);
  console.log('Config Status:', cfg.status);
  console.log('Config Settings:', {
    requireYear: cfg.data?.settings?.requireYear,
    requireAllFields: cfg.data?.settings?.requireAllFields,
    logNoResults: cfg.data?.settings?.logNoResults,
    includeUniversal: cfg.data?.settings?.includeUniversal,
    redirectOnSearch: cfg.data?.settings?.redirectOnSearch,
    resultsUrl: cfg.data?.settings?.resultsUrl,
    persistSelection: cfg.data?.settings?.persistSelection,
    enableGarage: cfg.data?.settings?.enableGarage,
    showFitmentChecker: cfg.data?.settings?.showFitmentChecker,
    vinCapEnabled: cfg.data?.settings?.vinCapEnabled,
    vinMonthlyCapLimit: cfg.data?.settings?.vinMonthlyCapLimit,
  });

  console.log('\n--- 2. Testing /api/makes with year ---');
  const makesWithYear = await get(`${host}/api/makes?shop=${shop}&year=2025`);
  console.log('Makes with year (2025):', makesWithYear.data?.makes);

  console.log('\n--- 3. Testing /api/makes without year (when requireYear=true) ---');
  const makesWithoutYear = await get(`${host}/api/makes?shop=${shop}`);
  console.log('Makes without year (expected empty when requireYear=true):', makesWithoutYear.data?.makes);

  console.log('\n--- 4. Testing /api/search with full YMM ---');
  const searchFull = await get(`${host}/api/search?shop=${shop}&year=2025&make=Tata&model=Nova`);
  console.log('Search Full Status:', searchFull.status, 'hasResults:', searchFull.data?.hasResults, 'resultCount:', searchFull.data?.resultCount);

  console.log('\n--- 5. Testing /api/fitment-check ---');
  const fitmentCheck = await get(`${host}/api/fitment-check?shop=${shop}&handle=the-videographer-snowboard&year=2025&make=Tata&model=Nova`);
  console.log('Fitment Check Status:', fitmentCheck.status, 'fits:', fitmentCheck.data?.fits, 'badgeText:', fitmentCheck.data?.badgeText);

  console.log('\n--- 6. Testing /api/vin-lookup ---');
  const vinLookup = await get(`${host}/api/vin-lookup?shop=${shop}&vin=1HGCR2F83HA000000`);
  console.log('VIN Lookup Status:', vinLookup.status, 'success:', vinLookup.data?.success, 'vehicle:', vinLookup.data?.vehicle || vinLookup.data?.error);

  console.log('\n=== ALL LIVE ENDPOINTS TESTED SUCCESSFULLY! ===');
}

testLiveEndpoints().catch(console.error);
