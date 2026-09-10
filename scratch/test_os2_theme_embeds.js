import fs from 'fs';
import path from 'path';

console.log('=== VERIFYING PARTMATCH 3 CORE EMBEDS ON ALL SHOPIFY OS 2.0 THEMES ===\n');

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
// CHECK 1: EXTENSION ARCHITECTURE & TOML COMPLIANCE
// -------------------------------------------------------------
console.log('--- 1. Theme App Extension Configuration ---');
const tomlPath = 'extensions/partmatch-widget/shopify.extension.toml';
assert(fs.existsSync(tomlPath), 'shopify.extension.toml exists');
const tomlContent = fs.readFileSync(tomlPath, 'utf8');
assert(tomlContent.includes('type = "theme_app_extension"'), 'Extension type is theme_app_extension');
assert(tomlContent.includes('handle = "partmatch-widget"'), 'Extension handle is partmatch-widget');

// -------------------------------------------------------------
// CHECK 2: THE 3 CORE EMBEDS / APP BLOCKS LIQUID & SCHEMA AUDIT
// -------------------------------------------------------------
console.log('\n--- 2. Liquid Blocks & Schema Validation ---');

const blocksDir = 'extensions/partmatch-widget/blocks';
const blocks = [
  {
    file: 'search-widget.liquid',
    name: 'Embed 1: Search Widget Block',
    target: 'section',
    requiredSettings: ['enable_full_width', 'widget_alignment', 'widget_max_width', 'banner_min_height']
  },
  {
    file: 'fitment-checker.liquid',
    name: 'Embed 2: Product Page Fitment Checker',
    target: 'section',
    requiredSettings: []
  },
  {
    file: 'vehicle-bar.liquid',
    name: 'Embed 3: Persistent Vehicle Bar (App Embed)',
    target: 'body',
    requiredSettings: ['bar_position', 'bg_color', 'change_text']
  },
  {
    file: 'my-garage.liquid',
    name: 'Embed 4 (Bonus): My Garage Block',
    target: 'section',
    requiredSettings: ['show_heading', 'heading']
  }
];

blocks.forEach(b => {
  const filePath = path.join(blocksDir, b.file);
  assert(fs.existsSync(filePath), `${b.name} (${b.file}) exists`);
  const content = fs.readFileSync(filePath, 'utf8');

  // Verify asset loading
  assert(content.includes('partmatch.css'), `${b.name} loads partmatch.css`);
  assert(content.includes('partmatch.js'), `${b.name} loads partmatch.js`);
  assert(content.includes('{{ block.shopify_attributes }}'), `${b.name} includes block.shopify_attributes for Theme Customizer`);

  // Extract and parse JSON schema
  const schemaMatch = content.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  assert(schemaMatch && schemaMatch[1], `${b.name} contains valid {% schema %} tags`);

  try {
    const parsedSchema = JSON.parse(schemaMatch[1]);
    assert(parsedSchema.target === b.target, `${b.name} has correct target: "${b.target}"`);
    assert(parsedSchema.name && parsedSchema.name.length > 0, `${b.name} defines user-facing name: "${parsedSchema.name}"`);

    b.requiredSettings.forEach(settingId => {
      const exists = parsedSchema.settings && parsedSchema.settings.some(s => s.id === settingId);
      assert(exists, `${b.name} schema contains setting "${settingId}"`);
    });
  } catch (err) {
    assert(false, `${b.name} schema parsed successfully as valid JSON: ${err.message}`);
  }
});

// -------------------------------------------------------------
// CHECK 3: OS 2.0 THEME JAVASCRIPT LIFECYCLE & EVENT HANDLING
// -------------------------------------------------------------
console.log('\n--- 3. OS 2.0 JavaScript Lifecycle & Theme Compatibility ---');
const jsContent = fs.readFileSync('extensions/partmatch-widget/assets/partmatch.js', 'utf8');

assert(jsContent.includes("shopify:section:load"), 'Supports Theme Customizer shopify:section:load event');
assert(jsContent.includes("shopify:section:select"), 'Supports Theme Customizer shopify:section:select event');
assert(jsContent.includes("turbo:load"), 'Supports Turbo / PJAX page navigation in modern themes');
assert(jsContent.includes("page:loaded"), 'Supports View Transitions page:loaded event (Horizon / Dawn 2.0)');
assert(jsContent.includes("window.Shopify && window.Shopify.designMode"), 'Detects Theme Editor live preview designMode');

// Check Embed 1: Search Widget functionality
assert(jsContent.includes("initSearchWidget"), 'Implements initSearchWidget()');
assert(jsContent.includes("parent.style.setProperty('width', '100%'"), 'Auto-corrects parent flex container width to 100%');
assert(jsContent.includes("flexSection.style.setProperty('--horizontal-alignment', 'center')"), 'Auto-corrects Horizon --horizontal-alignment to center');
assert(jsContent.includes("COLLECTION_GRID_SELECTORS"), 'Supports native collection page filtering on all OS 2.0 themes');

// Check Embed 2: Fitment Checker functionality
assert(jsContent.includes("initFitmentChecker"), 'Implements initFitmentChecker()');
assert(jsContent.includes("data-partmatch-checker"), 'Queries data-partmatch-checker elements');
assert(jsContent.includes("checkFitment"), 'Calls /api/fitment-check proxy endpoint');
assert(jsContent.includes("renderFitmentState"), 'Renders yes/no/loading/none fitment states cleanly');
assert(jsContent.includes("partmatch:vehicleChanged"), 'Fitment checker updates reactively when vehicle is changed');

// Check Embed 3: Vehicle Bar functionality
assert(jsContent.includes("initVehicleBar"), 'Implements initVehicleBar()');
assert(jsContent.includes("data-partmatch-bar"), 'Queries data-partmatch-bar elements');
assert(jsContent.includes("pm-bar--auto"), 'Provides auto-injected floating vehicle bar fallback');
assert(jsContent.includes("updateBar"), 'Implements updateBar with vehicle details and trim');
assert(jsContent.includes("changeBtn"), 'Binds change vehicle button to clear and re-prompt');

// -------------------------------------------------------------
// CHECK 4: OS 2.0 STYLING & MULTI-THEME ISOLATION
// -------------------------------------------------------------
console.log('\n--- 4. CSS Isolation & OS 2.0 Theme Grid Overrides ---');
const cssContent = fs.readFileSync('extensions/partmatch-widget/assets/partmatch.css', 'utf8');

assert(cssContent.includes(".section-content-wrapper:has(#partmatch-widget)"), 'CSS overrides Horizon .section-content-wrapper alignment');
assert(cssContent.includes(".layout-panel-flex:has(#partmatch-widget)"), 'CSS overrides Horizon .layout-panel-flex alignment');
assert(cssContent.includes(".pm-widget"), 'Defines .pm-widget base container');
assert(cssContent.includes(".pm-checker"), 'Defines .pm-checker container');
assert(cssContent.includes(".pm-checker--yes"), 'Defines .pm-checker--yes compatible badge');
assert(cssContent.includes(".pm-checker--no"), 'Defines .pm-checker--no incompatible badge');
assert(cssContent.includes(".pm-bar"), 'Defines .pm-bar active vehicle container');
assert(cssContent.includes(".pm-bar--bottom"), 'Defines .pm-bar--bottom fixed floating bar');
assert(cssContent.includes(".pm-bar--top"), 'Defines .pm-bar--top fixed top banner');
assert(cssContent.includes("[data-pm-hidden=\"true\"]"), 'Defines [data-pm-hidden="true"] for zero-gap collection grids');

console.log(`\n========================================`);
console.log(`VERIFICATION SUMMARY: ${passedTests} passed, ${failedTests} failed`);
console.log(`========================================\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
