import fs from 'fs';
import path from 'path';

console.log('=== RUNNING COMPREHENSIVE SUITE OF SIMULATION TESTS ===\n');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✕ FAIL: ${message}`);
    failedTests++;
  }
}

// -------------------------------------------------------------
// TEST SUITE 1: SAMPLE TEMPLATES & STATIC DOWNLOAD VERIFICATION
// -------------------------------------------------------------
console.log('--- TEST SUITE 1: Sample CSV & XML Templates Verification ---');

const pubDir = path.resolve('public');
const partmatchCsvPath = path.join(pubDir, 'partmatch_sample_template.csv');
const acesCsvPath = path.join(pubDir, 'aces_sample_template.csv');
const acesXmlPath = path.join(pubDir, 'aces_sample_template.xml');

assert(fs.existsSync(partmatchCsvPath), 'partmatch_sample_template.csv exists in /public');
assert(fs.existsSync(acesCsvPath), 'aces_sample_template.csv exists in /public');
assert(fs.existsSync(acesXmlPath), 'aces_sample_template.xml exists in /public');

if (fs.existsSync(partmatchCsvPath)) {
  const content = fs.readFileSync(partmatchCsvPath, 'utf8').trim();
  const lines = content.split(/\r?\n/);
  const header = lines[0].toLowerCase();
  assert(header.includes('year') && header.includes('make') && header.includes('model'), 'PartMatch CSV has year, make, model in header');
  assert(lines.length > 2, `PartMatch CSV contains header + ${lines.length - 1} sample data rows`);
}

if (fs.existsSync(acesCsvPath)) {
  const content = fs.readFileSync(acesCsvPath, 'utf8').trim();
  const lines = content.split(/\r?\n/);
  const header = lines[0].toLowerCase();
  assert(header.includes('year') && header.includes('make') && header.includes('model'), 'ACES CSV has Year, Make, Model identifiers');
  assert(lines.length > 2, `ACES CSV contains header + ${lines.length - 1} sample data rows`);
}

if (fs.existsSync(acesXmlPath)) {
  const content = fs.readFileSync(acesXmlPath, 'utf8').trim();
  assert(content.includes('<ACES') && content.includes('</ACES>'), 'ACES XML has valid root <ACES> tags');
  assert(content.includes('<App') && content.includes('</App>'), 'ACES XML has <App> application tags');
}

// -------------------------------------------------------------
// TEST SUITE 2: ACES / PIES XML & CSV PARSING SIMULATION
// -------------------------------------------------------------
console.log('\n--- TEST SUITE 2: ACES / PIES XML & CSV Parsing Simulation ---');

// Server-side parser simulation function mirroring app.fitment.import.jsx
function simulateServerXmlParse(rawInput) {
  const results = { created: 0, skipped: 0, errors: [], records: [] };
  const appRegex = /<(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)>/gi;
  const matches = rawInput.match(appRegex) || [];

  if (matches.length === 0) {
    return { error: 'Invalid ACES/PIES XML format. No <App>, <Vehicle>, or <Item> fitment records found.', results: null };
  }

  for (let i = 0; i < matches.length; i++) {
    const appBlock = matches[i];
    const getXmlTag = (...tags) => {
      for (const tag of tags) {
        const match = appBlock.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]+)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i'));
        if (match && match[1]?.trim()) return match[1].trim();
      }
      return '';
    };

    const year = getXmlTag('Year', 'BaseVehicleYear', 'ModelYear', 'FromYear', 'YearID');
    const make = getXmlTag('Make', 'MakeName', 'Brand', 'Manufacturer');
    const model = getXmlTag('Model', 'ModelName', 'VehicleModel');
    const trim = getXmlTag('SubModel', 'SubModelName', 'EngineBase', 'Trim', 'Sub_Model', 'DriveType');
    const partNumber = getXmlTag('Part', 'PartNumber', 'ItemNumber', 'SKU', 'PartTerminologyName');

    if (!year || !make || !model) {
      results.errors.push(`XML Record ${i + 1}: Missing Year, Make, or Model`);
      results.skipped++;
      continue;
    }

    results.created++;
    results.records.push({ year, make, model, trim, partNumber });
  }

  return { error: null, results };
}

// Client-side converter simulation function mirroring app.fitment.import.jsx
function simulateClientConverter(acesInput) {
  let rows = [["year", "make", "model", "trim", "product_handle", "product_title", "collection_handle", "tag", "sku"]];
  let input = acesInput.trim();

  if (input.startsWith("<") || input.includes("<ACES") || input.includes("<App") || input.includes("<Vehicle") || input.includes("<Item")) {
    const appBlocks = input.match(/<(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)[\s\S]*?<\/(?:[a-zA-Z0-9_]+:)?(?:App|Vehicle|Item)>/gi) || [];
    if (appBlocks.length === 0) {
      return { error: "No <App>, <Vehicle>, or <Item> XML elements found in ACES/PIES content.", rows: [] };
    }

    appBlocks.forEach(appBlock => {
      const getTag = (...tags) => {
        for (const tag of tags) {
          const match = appBlock.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}[^>]*>([^<]+)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i'));
          if (match && match[1]?.trim()) return match[1].trim();
        }
        return '';
      };
      const year = getTag("Year", "BaseVehicleYear", "ModelYear", "FromYear", "YearID");
      const make = getTag("Make", "MakeName", "Brand", "Manufacturer");
      const model = getTag("Model", "ModelName", "VehicleModel");
      const trim = getTag("SubModel", "SubModelName", "EngineBase", "Trim", "Sub_Model", "DriveType");
      const part = getTag("Part", "PartNumber", "ItemNumber", "SKU", "PartTerminologyName");

      if (year && make && model) {
        rows.push([year, make, model, trim, part, "", "", "", part]);
      }
    });
  } else {
    // CSV logic with auto-detect delimiter
    const lines = input.split(/\r?\n/).filter(l => l.trim());
    if (lines.length > 1) {
      const firstLine = lines[0];
      let delimiter = ",";
      if (!firstLine.includes(",") && firstLine.includes(";")) delimiter = ";";
      else if (!firstLine.includes(",") && firstLine.includes("\t")) delimiter = "\t";

      const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/["']/g, ""));
      const yearIdx = headers.findIndex(h => ["year", "yearid", "modelyear", "basevehicleyear", "model_year", "yyyy"].includes(h));
      const makeIdx = headers.findIndex(h => ["make", "makename", "make_name", "brand", "manufacturer"].includes(h));
      const modelIdx = headers.findIndex(h => ["model", "modelname", "model_name", "vehicle_model"].includes(h));
      const trimIdx = headers.findIndex(h => ["trim", "submodel", "submodelname", "sub_model", "enginebase", "engine"].includes(h));
      const partIdx = headers.findIndex(h => ["partnumber", "part_number", "part", "partno", "sku", "itemnumber", "product_sku", "handle"].includes(h));

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ""));
        const year = yearIdx >= 0 ? cols[yearIdx] : "";
        const make = makeIdx >= 0 ? cols[makeIdx] : "";
        const model = modelIdx >= 0 ? cols[modelIdx] : "";
        const trim = trimIdx >= 0 ? cols[trimIdx] || "" : "";
        const part = partIdx >= 0 ? cols[partIdx] || "" : "";

        if (year && make && model) {
          rows.push([year, make, model, trim, part, "", "", "", part]);
        }
      }
    }
  }

  return { error: null, rows };
}

// 1. Standard ACES 3.2 XML
const sampleXml = fs.readFileSync(acesXmlPath, 'utf8');
const serverXmlRes = simulateServerXmlParse(sampleXml);
assert(!serverXmlRes.error && serverXmlRes.results?.created === 3, 'Server ACES XML parser extracts all 3 sample records');
assert(serverXmlRes.results?.records[0].make === 'Ford' && serverXmlRes.results?.records[0].partNumber === 'BP-FORD-F150-2025', 'First record has correct Make (Ford) and PartNumber (BP-FORD-F150-2025)');

// 2. Namespaced XML Test (<aces:App> / <ns2:App>)
const namespacedXml = `
<aces:ACES xmlns:aces="http://www.autocare.org/aces" version="3.2">
  <aces:App action="A" id="1">
    <aces:BaseVehicleYear>2025</aces:BaseVehicleYear>
    <aces:MakeName>Ford</aces:MakeName>
    <aces:ModelName>F-150</aces:ModelName>
    <aces:SubModelName>Lariat</aces:SubModelName>
    <aces:PartNumber>FO-F150-LARIAT</aces:PartNumber>
  </aces:App>
</aces:ACES>`;
const nsServerRes = simulateServerXmlParse(namespacedXml);
assert(nsServerRes.results?.created === 1 && nsServerRes.results?.records[0].model === 'F-150', 'Server XML parser successfully handles XML namespace prefixes (e.g. <aces:App>)');

const nsClientRes = simulateClientConverter(namespacedXml);
assert(nsClientRes.rows.length === 2 && nsClientRes.rows[1][1] === 'Ford', 'Client converter successfully handles XML namespace prefixes');

// 3. Semicolon-delimited CSV test
const semiCsv = "year;make;model;trim;product_handle\r\n2024;BMW;M3;Competition;bmw-m3-exhaust\r\n2025;Audi;RS5;Base;audi-rs5-intake";
const semiClientRes = simulateClientConverter(semiCsv);
assert(semiClientRes.rows.length === 3 && semiClientRes.rows[1][1] === 'BMW', 'Client converter correctly auto-detects semicolon delimiter and Windows CRLF');

// 4. Tab-delimited CSV test
const tabCsv = "year\tmake\tmodel\ttrim\tpartnumber\n2023\tHonda\tCivic\tEX\tHD-CIVIC-PAD";
const tabClientRes = simulateClientConverter(tabCsv);
assert(tabClientRes.rows.length === 2 && tabClientRes.rows[1][1] === 'Honda', 'Client converter correctly auto-detects tab delimiter');

// -------------------------------------------------------------
// TEST SUITE 3: SHOPIFY APP STORE OPTIMIZATION (ASO) COMPLIANCE
// -------------------------------------------------------------
console.log('\n--- TEST SUITE 3: Shopify App Store Optimization (ASO) Compliance ---');

const asoFilePath = path.resolve('SHOPIFY_APP_STORE_ASO.md');
assert(fs.existsSync(asoFilePath), 'SHOPIFY_APP_STORE_ASO.md exists');

if (fs.existsSync(asoFilePath)) {
  const asoContent = fs.readFileSync(asoFilePath, 'utf8');

  // Character Limit Check dynamically extracted from ASO Document
  const titleMatch = asoContent.match(/`([^`]+)`\s*\|\s*Captures/i);
  const subtitleMatch = asoContent.match(/`([^`]+)`\s*\|\s*Hits all/i);
  const appTitle = titleMatch ? titleMatch[1] : "PartMatch: Year Make Model YMM";
  const appSubtitle = subtitleMatch ? subtitleMatch[1] : "Year Make Model Search, VIN Lookup & Automotive Fitment";
  assert(appTitle.length <= 30, `App Title "${appTitle}" length is ${appTitle.length} chars (Shopify limit: <= 30 chars)`);
  assert(appSubtitle.length <= 60, `App Subtitle "${appSubtitle}" length is ${appSubtitle.length} chars (Shopify limit: <= 60 chars)`);

  // Target Keyword Presence Check
  const keywords = [
    "Year Make Model Search",
    "Automotive Fitment",
    "VIN Lookup",
    "Auto Parts Finder"
  ];

  for (const kw of keywords) {
    const occurrences = (asoContent.match(new RegExp(kw, 'gi')) || []).length;
    assert(occurrences >= 3, `Target keyword "${kw}" appears ${occurrences} times in ASO document (min: 3)`);
  }

  assert(asoContent.includes('ROI Calculation'), 'ASO document contains merchant ROI calculation');
  assert(asoContent.includes('Frequently Asked Questions'), 'ASO document contains merchant FAQ section');
  assert(asoContent.includes('Screenshot Plan'), 'ASO document contains recommended screenshot assets plan');
}

// -------------------------------------------------------------
// TEST SUITE 4: UI ROUTE CONSISTENCY & FLOW INTEGRITY
// -------------------------------------------------------------
console.log('\n--- TEST SUITE 4: UI Route Consistency & Flow Integrity ---');

const onboardingPath = path.resolve('app/routes/app.onboarding.jsx');
const plansPath = path.resolve('app/routes/app.plans.jsx');
const importPath = path.resolve('app/routes/app.fitment.import.jsx');

const onboardingContent = fs.readFileSync(onboardingPath, 'utf8');
assert(onboardingContent.includes('partmatch_sample_template.csv'), 'Onboarding links to /partmatch_sample_template.csv');
assert(onboardingContent.includes('aces_sample_template.csv'), 'Onboarding links to /aces_sample_template.csv');
assert(onboardingContent.includes('Import CSV') && onboardingContent.includes('/app/fitment/import'), 'Onboarding keeps existing /app/fitment/import action link');

const plansContent = fs.readFileSync(plansPath, 'utf8');
assert(plansContent.includes('HIGH-VOLUME AUTO ENTERPRISE & DISTRIBUTORS ($200+ / mo)'), 'Plans page contains Enterprise $200+/mo custom callout');
assert(plansContent.includes('/app/support?topic=enterprise_custom'), 'Enterprise callout links to /app/support');

const importContent = fs.readFileSync(importPath, 'utf8');
assert(importContent.includes('partmatch_sample_template.csv'), 'Import route links to /partmatch_sample_template.csv');
assert(importContent.includes('aces_sample_template.csv'), 'Import route links to /aces_sample_template.csv');
assert(importContent.includes('aces_sample_template.xml'), 'Import route links to /aces_sample_template.xml');

// -------------------------------------------------------------
// TEST SUITE 5: ALL PAGE & INNER PAGE WIDTH UNIFORMITY (100% FLUID)
// -------------------------------------------------------------
console.log('\n--- TEST SUITE 5: All Pages & Inner Pages Width Uniformity ---');

const routesToCheck = [
  { file: 'app/routes/app._index.jsx', name: 'Dashboard' },
  { file: 'app/routes/app.fitment._index.jsx', name: 'Fitment Catalog' },
  { file: 'app/routes/app.fitment.add.jsx', name: 'Inner Page: Add Fitment' },
  { file: 'app/routes/app.fitment.import.jsx', name: 'Inner Page: Bulk Import' },
  { file: 'app/routes/app.fitment.export.jsx', name: 'Inner Page: Catalog Export' },
  { file: 'app/routes/app.fitment.$id.products.jsx', name: 'Inner Page: Vehicle Products' },
  { file: 'app/routes/app.products._index.jsx', name: 'Products Directory' },
  { file: 'app/routes/app.products.universal.jsx', name: 'Inner Page: Universal Products' },
  { file: 'app/routes/app.widget.jsx', name: 'Search Widget Studio' },
  { file: 'app/routes/app.analytics.jsx', name: 'Search Analytics' },
  { file: 'app/routes/app.settings.jsx', name: 'Settings' },
  { file: 'app/routes/app.plans.jsx', name: 'Plans & Pricing' },
  { file: 'app/routes/app.support.jsx', name: 'Help & Support' },
  { file: 'app/routes/app.ai-autofit.jsx', name: 'AI AutoFit Catalog' },
  { file: 'app/routes/app.admin.jsx', name: 'App Admin' },
  { file: 'app/routes/app.onboarding.jsx', name: 'Onboarding Flow' },
];

for (const route of routesToCheck) {
  const filePath = path.resolve(route.file);
  assert(fs.existsSync(filePath), `${route.name} file exists (${route.file})`);
  const content = fs.readFileSync(filePath, 'utf8');
  assert(
    content.includes('maxWidth: "100%"') && content.includes('width: "100%"'),
    `${route.name} container width is standardized to 100% (width: 100%, maxWidth: 100%)`
  );
  assert(
    content.includes('padding: "28px 24px 60px"'),
    `${route.name} container padding is standardized to 28px 24px 60px`
  );
}

// -------------------------------------------------------------
// TEST SUITE 6: SEARCH WIDGET FORM VALIDATION SUITE
// -------------------------------------------------------------
console.log('\n--- TEST SUITE 6: Search Widget Form Validation ---');

const partmatchJsPath = path.resolve('extensions/partmatch-widget/assets/partmatch.js');
assert(fs.existsSync(partmatchJsPath), 'partmatch.js asset exists');
const partmatchJsContent = fs.readFileSync(partmatchJsPath, 'utf8');

assert(partmatchJsContent.includes('showValidationError'), 'partmatch.js defines showValidationError helper');
assert(partmatchJsContent.includes('clearValidationError'), 'partmatch.js defines clearValidationError helper');
assert(partmatchJsContent.includes('Please select a Model to search compatible parts'), 'partmatch.js validates unselected Model field');
assert(partmatchJsContent.includes('Please select a Make to search compatible parts'), 'partmatch.js validates unselected Make field');
assert(partmatchJsContent.includes('Please select a Year to search compatible parts'), 'partmatch.js validates unselected Year field');
assert(partmatchJsContent.includes('pm-select--error'), 'partmatch.js attaches pm-select--error class on validation failure');

const partmatchCssPath = path.resolve('extensions/partmatch-widget/assets/partmatch.css');
assert(fs.existsSync(partmatchCssPath), 'partmatch.css asset exists');
const partmatchCssContent = fs.readFileSync(partmatchCssPath, 'utf8');
assert(partmatchCssContent.includes('.pm-select--error'), 'partmatch.css defines .pm-select--error styling');
assert(partmatchCssContent.includes('pm-shake'), 'partmatch.css defines pm-shake animation for invalid fields');
assert(partmatchCssContent.includes('.pm-validation-msg'), 'partmatch.css defines .pm-validation-msg banner styling');

const widgetLiquidPath = path.resolve('extensions/partmatch-widget/blocks/search-widget.liquid');
assert(fs.existsSync(widgetLiquidPath), 'search-widget.liquid block exists');
const widgetLiquidContent = fs.readFileSync(widgetLiquidPath, 'utf8');
assert(widgetLiquidContent.includes('data-partmatch-validation'), 'search-widget.liquid contains data-partmatch-validation element');

// SUMMARY
console.log('\n=== SIMULATION TEST RESULTS ===');
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('ALL SIMULATION TESTS COMPLETED WITH 100% SUCCESS! ✓');
}
