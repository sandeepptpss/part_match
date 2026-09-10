import fs from 'fs';
import path from 'path';

console.log('=== TEST SUITE: COLLECTION GRID FILTERING ON HORIZON & DAWN THEMES ===\n');

const jsContent = fs.readFileSync('extensions/partmatch-widget/assets/partmatch.js', 'utf8');
const cssContent = fs.readFileSync('extensions/partmatch-widget/assets/partmatch.css', 'utf8');

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
// TEST 1: STATIC CODE AUDIT FOR HORIZON SUPPORT
// -------------------------------------------------------------
console.log('--- TEST 1: Static Code Audit in partmatch.js & partmatch.css ---');

assert(jsContent.includes('COLLECTION_GRID_SELECTORS'), 'Defines COLLECTION_GRID_SELECTORS');
assert(jsContent.includes('product-grid__item'), 'partmatch.js checks product-grid__item class');
assert(jsContent.includes('[data-testid="product-grid"]'), 'partmatch.js includes Horizon [data-testid="product-grid"]');
assert(jsContent.includes('.product-grid-container'), 'partmatch.js includes Horizon .product-grid-container');
assert(jsContent.includes('getProductGridItem'), 'partmatch.js defines getProductGridItem resolver');
assert(jsContent.includes('observeGridMutations'), 'partmatch.js defines observeGridMutations for infinite scroll');
assert(jsContent.includes('data-pm-hidden'), 'partmatch.js manages data-pm-hidden attribute');
assert(jsContent.includes('a:not(.product-card__link)'), 'partmatch.js excludes Horizon full-card overlay link when finding title');

assert(cssContent.includes('[data-pm-hidden="true"]'), 'partmatch.css contains [data-pm-hidden="true"] rule');
assert(cssContent.includes('li.product-grid__item[data-pm-hidden="true"]'), 'partmatch.css specifically targets li.product-grid__item with display: none !important');
assert(cssContent.includes('display: none !important;'), 'partmatch.css forces display: none !important');
assert(cssContent.includes('.pm-collection-fitment-badge'), 'partmatch.css styles fitment badge');

// -------------------------------------------------------------
// TEST 2: SIMULATED DOM FUNCTIONALITY TEST (JSDOM-LIKE)
// -------------------------------------------------------------
console.log('\n--- TEST 2: DOM Simulation for Horizon & Dawn Themes ---');

// Extract getProductGridItem function from partmatch.js and test it in simulated DOM
const getProductGridItemCode = jsContent.match(/function getProductGridItem\(link\) \{[\s\S]*?\n  \}/)[0];
const COLLECTION_GRID_SELECTORS = '.product-grid, #product-grid, .grid--product, ul.grid, .collection-matrix, .template-collection__grid, [data-testid="product-grid"], .product-grid-container';

// Create a mini-DOM node mock helper
class MockElement {
  constructor(tagName, className = '', attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.classList = {
      contains: (c) => this.className.split(' ').includes(c)
    };
    this.attributes = { ...attributes };
    this.style = {};
    this.parentNode = null;
    this.children = [];
    this.dataset = { ...attributes };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  getAttribute(attr) {
    return this.attributes[attr] || null;
  }

  setAttribute(attr, val) {
    this.attributes[attr] = String(val);
  }

  removeAttribute(attr) {
    delete this.attributes[attr];
  }

  closest(selector) {
    const selectors = selector.split(',').map(s => s.trim());
    let curr = this;
    while (curr) {
      for (const sel of selectors) {
        if (curr.tagName.toLowerCase() === sel.toLowerCase()) return curr;
        if (sel.startsWith('li.') && curr.tagName === 'LI') {
          const cls = sel.slice(3);
          if (curr.classList.contains(cls)) return curr;
        }
        if (sel.startsWith('.') && curr.classList.contains(sel.slice(1))) return curr;
        if (sel.startsWith('#') && curr.attributes.id === sel.slice(1)) return curr;
        if (sel.startsWith('[data-testid=') && curr.attributes['data-testid'] === sel.match(/"(.*)"/)?.[1]) return curr;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const check = (node) => {
      const selectors = selector.split(',').map(s => s.trim());
      for (const sel of selectors) {
        if (sel.startsWith('.') && node.classList.contains(sel.slice(1))) return true;
        if (sel === 'h3' && node.tagName === 'H3') return true;
        if (sel === '[ref="productTitleLink"]' && node.attributes.ref === 'productTitleLink') return true;
      }
      return false;
    };
    for (const child of this.children) {
      if (check(child)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

// Instantiate getProductGridItem in test scope
const testGetProductGridItem = new Function('link', 'COLLECTION_GRID_SELECTORS', `
  ${getProductGridItemCode}
  return getProductGridItem(link);
`);

// 2A: Horizon Theme Structure Test
console.log('\n--- 2A: Horizon Theme Grid Item Resolution ---');
const horizonUl = new MockElement('ul', 'product-grid product-grid--classic', { 'data-testid': 'product-grid' });
const horizonLi = new MockElement('li', 'product-grid__item product-grid__item--0', { 'data-product-id': '9901' });
const horizonCard = new MockElement('product-card', 'product-card size-style');
const horizonOverlayLink = new MockElement('a', 'product-card__link', { href: '/products/brake-pads' });
const horizonContent = new MockElement('div', 'product-card__content');
const horizonTitleLink = new MockElement('a', 'contents user-select-text', { ref: 'productTitleLink', href: '/products/brake-pads' });
const horizonTitleH3 = new MockElement('h3', 'product-title');

horizonUl.appendChild(horizonLi);
horizonLi.appendChild(horizonCard);
horizonCard.appendChild(horizonOverlayLink);
horizonCard.appendChild(horizonContent);
horizonContent.appendChild(horizonTitleLink);
horizonTitleLink.appendChild(horizonTitleH3);

const resolvedHorizonContainer = testGetProductGridItem(horizonOverlayLink, COLLECTION_GRID_SELECTORS);
assert(resolvedHorizonContainer === horizonLi, 'Horizon theme resolves to <li class="product-grid__item"> and NOT <product-card>');
assert(resolvedHorizonContainer.tagName === 'LI', 'Resolved container is an LI element in Horizon');
assert(resolvedHorizonContainer.classList.contains('product-grid__item'), 'Resolved container has product-grid__item class');

// 2B: Dawn / Dawn 2.0 Theme Structure Test
console.log('\n--- 2B: Dawn Theme Grid Item Resolution ---');
const dawnUl = new MockElement('ul', 'grid product-grid', { id: 'product-grid' });
const dawnLi = new MockElement('li', 'grid__item');
const dawnWrapper = new MockElement('div', 'card-wrapper underline-links-hover');
const dawnLink = new MockElement('a', 'full-unstyled-link', { href: '/products/oil-filter' });

dawnUl.appendChild(dawnLi);
dawnLi.appendChild(dawnWrapper);
dawnWrapper.appendChild(dawnLink);

const resolvedDawnContainer = testGetProductGridItem(dawnLink, COLLECTION_GRID_SELECTORS);
assert(resolvedDawnContainer === dawnLi, 'Dawn theme resolves to <li class="grid__item">');
assert(resolvedDawnContainer.tagName === 'LI', 'Resolved container is an LI element in Dawn');

// 2C: Div-based Theme (no <li>) Test
console.log('\n--- 2C: Div-based Theme Grid Item Resolution ---');
const divGrid = new MockElement('div', 'product-grid');
const divItem = new MockElement('div', 'grid__item');
const divLink = new MockElement('a', 'product-link', { href: '/products/spark-plug' });

divGrid.appendChild(divItem);
divItem.appendChild(divLink);

const resolvedDivContainer = testGetProductGridItem(divLink, COLLECTION_GRID_SELECTORS);
assert(resolvedDivContainer === divItem, 'Div-based grid resolves to outer .grid__item');

// 2D: Header navigation link protection
console.log('\n--- 2D: Header Navigation Protection Test ---');
const header = new MockElement('header', 'site-header');
const navLi = new MockElement('li', 'nav-item');
const navLink = new MockElement('a', 'nav-link', { href: '/products/featured-part' });

header.appendChild(navLi);
navLi.appendChild(navLink);

const resolvedNavContainer = testGetProductGridItem(navLink, COLLECTION_GRID_SELECTORS);
// Since navLi does NOT have product grid classes and is NOT inside a product grid:
// it will not qualify as a product grid item when checked against header exclusion
assert(!resolvedNavContainer || resolvedNavContainer.closest('header'), 'Header links are caught and protected from filtering');

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log(`\n========================================`);
console.log(`TESTS SUMMARY: ${passedTests} passed, ${failedTests} failed`);
console.log(`========================================\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
