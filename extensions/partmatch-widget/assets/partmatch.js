/**
 * PartMatch — Year Make Model Search Widget
 * Storefront JS for dependent dropdowns, persistent vehicle selection,
 * product page fitment checker, and My Garage.
 *
 * All API calls go through the Shopify App Proxy at /apps/partmatch/*,
 * so requests are same-origin on the storefront domain.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'partmatch_vehicle';
  const GARAGE_KEY  = 'partmatch_garage';
  const PROXY_BASE  = '/apps/partmatch';

  let appConfig = null; // resolved once by loadConfig()

  // ─── Config ─────────────────────────────────────────────────────────────────
  async function loadConfig() {
    if (appConfig) return appConfig;
    try {
      const res = await fetch(`${PROXY_BASE}/api/config`);
      appConfig = await res.json();
    } catch {
      appConfig = { widget: null, settings: null };
    }
    return appConfig;
  }

  function settingsAllow(key) {
    const settings = appConfig?.settings;
    if (!settings) return true;
    return settings[key] !== false;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function savedVehicle() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  }

  function saveVehicle(v) {
    if (!settingsAllow('persistSelection')) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    dispatchVehicleEvent(v);
  }

  function clearVehicle() {
    localStorage.removeItem(STORAGE_KEY);
    dispatchVehicleEvent(null);
  }

  function dispatchVehicleEvent(v) {
    document.dispatchEvent(new CustomEvent('partmatch:vehicleChanged', { detail: v }));
  }

  // ─── Garage ─────────────────────────────────────────────────────────────────
  let garageMode = null;
  let serverGarageCache = [];

  async function resolveGarageMode() {
    if (garageMode) return;
    try {
      const res = await fetch(`${PROXY_BASE}/api/garage`);
      const data = await res.json();
      if (data.loggedIn) {
        garageMode = 'server';
        serverGarageCache = data.vehicles || [];
      } else {
        garageMode = 'local';
      }
    } catch {
      garageMode = 'local';
    }
  }

  function getLocalGarage() {
    try { return JSON.parse(localStorage.getItem(GARAGE_KEY)) || []; } catch { return []; }
  }

  async function getGarage() {
    await resolveGarageMode();
    return garageMode === 'server' ? serverGarageCache : getLocalGarage();
  }

  async function addToGarage(v) {
    if (!settingsAllow('enableGarage')) return;
    await resolveGarageMode();

    if (garageMode === 'server') {
      try {
        const res = await fetch(`${PROXY_BASE}/api/garage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'add', ...v }),
        });
        const data = await res.json();
        if (data.vehicles) serverGarageCache = data.vehicles;
      } catch { /* best-effort */ }
      return;
    }

    const garage = getLocalGarage();
    const exists = garage.some(g => g.year === v.year && g.make === v.make && g.model === v.model);
    if (!exists) { garage.unshift(v); localStorage.setItem(GARAGE_KEY, JSON.stringify(garage.slice(0, 5))); }
  }

  async function removeFromGarage(year, make, model) {
    await resolveGarageMode();

    if (garageMode === 'server') {
      try {
        const res = await fetch(`${PROXY_BASE}/api/garage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'remove', year, make, model }),
        });
        const data = await res.json();
        if (data.vehicles) serverGarageCache = data.vehicles;
      } catch { /* best-effort */ }
      return;
    }

    const garage = getLocalGarage().filter(g => !(g.year === year && g.make === make && g.model === model));
    localStorage.setItem(GARAGE_KEY, JSON.stringify(garage));
  }

  // ─── API Calls ───────────────────────────────────────────────────────────────
  async function fetchYears() {
    const res = await fetch(`${PROXY_BASE}/api/years`);
    return (await res.json()).years || [];
  }

  async function fetchMakes(year) {
    const res = await fetch(`${PROXY_BASE}/api/makes?year=${encodeURIComponent(year)}`);
    return (await res.json()).makes || [];
  }

  async function fetchModels(year, make) {
    const res = await fetch(`${PROXY_BASE}/api/models?year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}`);
    return (await res.json()).models || [];
  }

  async function doSearch(year, make, model) {
    const res = await fetch(`${PROXY_BASE}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, make, model }),
    });
    return res.json();
  }

  async function checkFitment(handle, year, make, model) {
    const res = await fetch(`${PROXY_BASE}/api/fitment-check?handle=${encodeURIComponent(handle)}&year=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
    return res.json();
  }

  // Fetch standard Shopify product details via AJAX JSON endpoint
  async function fetchProductDetails(handle) {
    try {
      const res = await fetch(`/products/${encodeURIComponent(handle)}.js`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function isDarkColor(colorHex) {
    if (!colorHex || typeof colorHex !== 'string') return false;
    let hex = colorHex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6) return false;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
  }

  function applyWidgetSettings(widget, widgetSettings) {
    if (!widgetSettings) return;

    const primary = widgetSettings.primaryColor || '#0f172a';
    const bg = widgetSettings.backgroundColor || '#ffffff';
    const isDark = isDarkColor(bg);

    const text = isDark ? (widgetSettings.textColor || '#ffffff') : ((widgetSettings.textColor && widgetSettings.textColor !== '#ffffff') ? widgetSettings.textColor : '#0f172a');
    const subheadingColor = isDark ? '#94a3b8' : '#64748b';

    widget.style.setProperty('--pm-primary', primary);
    widget.style.setProperty('--pm-bg', bg);
    widget.style.setProperty('--pm-text', text);
    widget.style.setProperty('--pm-radius', `${widgetSettings.borderRadius || 6}px`);
    widget.style.setProperty('--pm-btn-radius', `${widgetSettings.borderRadius || 6}px`);
    widget.style.backgroundColor = bg;
    widget.style.color = text;
    widget.classList.toggle('pm-widget--stacked', widgetSettings.layout === 'stacked');

    const headingSmall = widget.querySelector('.pm-widget__heading-small');
    if (headingSmall && widgetSettings.subheading) {
      headingSmall.textContent = widgetSettings.subheading;
      headingSmall.style.color = subheadingColor;
      headingSmall.style.display = widgetSettings.showSubheading !== false ? '' : 'none';
    }
    const headingEl = widget.querySelector('.pm-widget__heading');
    if (headingEl && widgetSettings.heading) {
      headingEl.textContent = widgetSettings.heading;
      headingEl.style.color = text;
      headingEl.style.display = widgetSettings.showHeading !== false ? '' : 'none';
    }

    const yearSel = widget.querySelector('[data-partmatch-year]');
    const makeSel = widget.querySelector('[data-partmatch-make]');
    const modelSel = widget.querySelector('[data-partmatch-model]');
    if (yearSel && widgetSettings.yearLabel) yearSel.dataset.placeholder = widgetSettings.yearLabel;
    if (makeSel && widgetSettings.makeLabel) makeSel.dataset.placeholder = widgetSettings.makeLabel;
    if (modelSel && widgetSettings.modelLabel) modelSel.dataset.placeholder = widgetSettings.modelLabel;

    const searchBtn = widget.querySelector('[data-partmatch-search]');
    if (searchBtn && widgetSettings.searchButtonText) {
      const spinner = searchBtn.querySelector('[data-partmatch-spinner]');
      searchBtn.textContent = widgetSettings.searchButtonText;
      if (spinner) searchBtn.appendChild(spinner);
      searchBtn.style.background = 'var(--pm-primary, #0f172a)';
      searchBtn.style.color = '#ffffff';
    }
    const clearBtn = widget.querySelector('[data-partmatch-clear]');
    if (clearBtn && widgetSettings.clearButtonText) clearBtn.textContent = widgetSettings.clearButtonText;
  }

  // ─── Populate Select ─────────────────────────────────────────────────────────
  function populateSelect(select, options, placeholder) {
    select.innerHTML = '';
    const def = document.createElement('option');
    def.value = ''; def.textContent = placeholder; def.disabled = true; def.selected = true;
    select.appendChild(def);
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      select.appendChild(opt);
    });
  }

  function setLoading(select, loading) {
    select.disabled = loading;
  }

  // ─── Search Widget ───────────────────────────────────────────────────────────
  async function initSearchWidget(widget) {
    const isDesignMode = window.Shopify && window.Shopify.designMode;
    if (!isDesignMode) {
      const config = await loadConfig();
      if (config && config.widget) {
        applyWidgetSettings(widget, config.widget);
      }
    }

    const yearSel   = widget.querySelector('[data-partmatch-year]');
    const makeSel   = widget.querySelector('[data-partmatch-make]');
    const modelSel  = widget.querySelector('[data-partmatch-model]');
    const searchBtn = widget.querySelector('[data-partmatch-search]');
    const clearBtn  = widget.querySelector('[data-partmatch-clear]');
    const spinner   = widget.querySelector('[data-partmatch-spinner]');
    const resultsEl = widget.querySelector('[data-partmatch-results]');

    if (!yearSel || !makeSel || !modelSel || !searchBtn) return;

    // Initial state
    makeSel.disabled  = true;
    modelSel.disabled = true;
    searchBtn.disabled = true;

    // Load years
    try {
      setLoading(yearSel, true);
      const years = await fetchYears();
      populateSelect(yearSel, years, yearSel.dataset.placeholder || 'YEAR');
      yearSel.disabled = false;
    } catch { yearSel.disabled = false; }

    // Check URL parameters for search query
    const urlParams = new URLSearchParams(window.location.search);
    const urlYear  = urlParams.get('year');
    const urlMake  = urlParams.get('make');
    const urlModel = urlParams.get('model');

    const saved = settingsAllow('persistSelection') ? savedVehicle() : null;
    const activeVehicle = (urlYear && urlMake && urlModel) ? { year: urlYear, make: urlMake, model: urlModel } : saved;

    if (activeVehicle && activeVehicle.year) {
      const restoreVehicle = async () => {
        yearSel.value = activeVehicle.year;
        yearSel.dispatchEvent(new Event('change'));
        
        // Wait for makes to load with a timeout
        await new Promise(r => {
          let attempts = 0;
          const checkMakes = () => {
            if (!makeSel.disabled && makeSel.options.length > 1) {
              r();
            } else if (attempts > 60) {
              r();
            } else {
              attempts++;
              setTimeout(checkMakes, 50);
            }
          };
          checkMakes();
        });

        if (activeVehicle.make) {
          makeSel.value = activeVehicle.make;
          makeSel.dispatchEvent(new Event('change'));
          
          // Wait for models to load with a timeout
          await new Promise(r => {
            let attempts = 0;
            const checkModels = () => {
              if (!modelSel.disabled && modelSel.options.length > 1) {
                r();
              } else if (attempts > 60) {
                r();
              } else {
                attempts++;
                setTimeout(checkModels, 50);
              }
            };
            checkModels();
          });

          if (activeVehicle.model) {
            modelSel.value = activeVehicle.model;
            modelSel.dispatchEvent(new Event('change'));
            searchBtn.disabled = false;

            // Auto-trigger search if coming via URL query parameters
            if (urlYear && urlMake && urlModel && resultsEl) {
              if (spinner) spinner.style.display = 'inline-block';
              const result = await doSearch(urlYear, urlMake, urlModel);
              if (spinner) spinner.style.display = 'none';
              await renderResults(resultsEl, result);
            }
          }
        }
      };
      setTimeout(restoreVehicle, 300);
    }

    // Year change
    yearSel.addEventListener('change', async () => {
      const year = yearSel.value;
      makeSel.disabled = true; modelSel.disabled = true; searchBtn.disabled = true;
      if (!year) return;
      setLoading(makeSel, true);
      const makes = await fetchMakes(year);
      populateSelect(makeSel, makes, makeSel.dataset.placeholder || 'MAKE');
      makeSel.disabled = false;
      populateSelect(modelSel, [], modelSel.dataset.placeholder || 'MODEL');
    });

    // Make change
    makeSel.addEventListener('change', async () => {
      const year = yearSel.value; const make = makeSel.value;
      modelSel.disabled = true; searchBtn.disabled = true;
      if (!year || !make) return;
      setLoading(modelSel, true);
      const models = await fetchModels(year, make);
      populateSelect(modelSel, models, modelSel.dataset.placeholder || 'MODEL');
      modelSel.disabled = false;
    });

    // Model change
    modelSel.addEventListener('change', () => {
      searchBtn.disabled = !modelSel.value;
    });

    // Search click
    searchBtn.addEventListener('click', async () => {
      const year = yearSel.value; const make = makeSel.value; const model = modelSel.value;
      if (!year || !make || !model) return;

      searchBtn.disabled = true;
      if (spinner) spinner.style.display = 'inline-block';

      // Save vehicle & garage
      saveVehicle({ year, make, model });
      await addToGarage({ year, make, model });

      // Determine redirect URL & mode (App settings take precedence over theme block default)
      const rawResultsUrl = config.settings?.resultsUrl || widget.dataset.resultsUrl || '/collections/all';
      const targetUrl = rawResultsUrl.split('?')[0].replace(/\/$/, '') || '/collections/all';
      const currentPath = window.location.pathname.replace(/\/$/, '');
      const isResultsPage = currentPath === targetUrl;

      // Redirect if configured in app settings OR theme block, unless already on results page or explicitly forced inline
      const showInlineTheme = widget.dataset.showInline === 'true';
      const redirectConfigured = config.settings?.redirectOnSearch || widget.dataset.resultsMode === 'separate_page';
      const shouldRedirect = redirectConfigured && !showInlineTheme && !isResultsPage;

      if (shouldRedirect) {
        const q = new URLSearchParams({ year, make, model });
        window.location.href = `${targetUrl}?${q.toString()}`;
        return;
      }

      // Inline (Same Page) display
      const result = await doSearch(year, make, model);
      searchBtn.disabled = false;
      if (spinner) spinner.style.display = 'none';

      if (resultsEl) {
        await renderResults(resultsEl, result);
      }
    });

    // Clear click
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        yearSel.value = '';
        populateSelect(makeSel, [], makeSel.dataset.placeholder || 'MAKE');
        populateSelect(modelSel, [], modelSel.dataset.placeholder || 'MODEL');
        makeSel.disabled = true; modelSel.disabled = true; searchBtn.disabled = true;
        if (resultsEl) resultsEl.innerHTML = '';
        clearVehicle();
      });
    }
  }

  // ─── Render Results ─────────────────────────────────────────────────────────
  async function renderResults(el, result) {
    if (!result.hasResults || !result.products.length) {
      el.innerHTML = `
        <div class="pm-no-results">
          <h3>No products found</h3>
          <p>No compatible products for <strong>${result.year} ${result.make} ${result.model}</strong>.</p>
          <div class="pm-no-results__actions">
            <button class="pm-btn pm-btn--primary" onclick="document.querySelector('[data-partmatch-clear]')?.click()">Change Vehicle</button>
            <a href="/pages/contact" class="pm-btn pm-btn--secondary">Contact Us</a>
          </div>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="pm-results">
        <div class="pm-results__header">
          <span class="pm-results__label">Matching products for:</span>
          <strong class="pm-results__vehicle">${result.year} ${result.make} ${result.model}</strong>
          <span class="pm-results__count">(${result.resultCount} product${result.resultCount !== 1 ? 's' : ''})</span>
        </div>
        <div class="pm-results__grid" id="pm-results-grid">
          <div class="pm-results__loading">Loading product listings…</div>
        </div>
      </div>`;

    const gridEl = el.querySelector('#pm-results-grid');
    if (!gridEl) return;

    // Fetch product details for rich card display
    const cardPromises = result.products.map(async (p) => {
      const details = await fetchProductDetails(p.shopifyHandle);
      const title = details?.title || p.productTitle || p.shopifyHandle;
      const priceStr = details?.price ? `$${(details.price / 100).toFixed(2)}` : '';
      const imageSrc = details?.featured_image || details?.images?.[0] || '';

      return `
        <a href="/products/${p.shopifyHandle}" class="pm-product-card">
          <div class="pm-product-card__img-wrap">
            ${imageSrc ? `<img src="${imageSrc}" alt="${title}" loading="lazy" class="pm-product-card__img"/>` : `<div class="pm-product-card__placeholder">No Image</div>`}
          </div>
          <div class="pm-product-card__content">
            <div class="pm-product-card__badge">✓ Fits ${result.year} ${result.make} ${result.model}</div>
            <h4 class="pm-product-card__title">${title}</h4>
            ${priceStr ? `<div class="pm-product-card__price">${priceStr}</div>` : ''}
            <div class="pm-product-card__btn">View Details →</div>
          </div>
        </a>`;
    });

    const cardsHtml = await Promise.all(cardPromises);
    gridEl.innerHTML = cardsHtml.join('');
  }

  // ─── Active Vehicle Bar ──────────────────────────────────────────────────────
  function initVehicleBar() {
    const bars = document.querySelectorAll('[data-partmatch-bar]');
    if (!bars.length) return;
    bars.forEach(bar => updateBar(bar));

    document.addEventListener('partmatch:vehicleChanged', () => {
      bars.forEach(bar => updateBar(bar));
    });
  }

  function updateBar(bar) {
    const v = savedVehicle();
    if (!v || !v.year) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    const label = bar.querySelector('[data-partmatch-bar-label]');
    if (label) label.textContent = `${v.year} ${v.make} ${v.model}`;
    const changeBtn = bar.querySelector('[data-partmatch-bar-change]');
    if (changeBtn) changeBtn.addEventListener('click', () => {
      clearVehicle();
      bar.style.display = 'none';
      const widget = document.querySelector('[data-partmatch-widget]');
      if (widget) widget.querySelector('[data-partmatch-clear]')?.click();
    });
  }

  // ─── Product Page Fitment Checker ────────────────────────────────────────────
  async function initFitmentChecker() {
    const checkers = document.querySelectorAll('[data-partmatch-checker]');
    if (!checkers.length) return;

    const config = await loadConfig();
    if (!settingsAllow('showFitmentChecker')) {
      checkers.forEach(c => { c.innerHTML = ''; c.style.display = 'none'; });
      return;
    }

    const v = savedVehicle();

    await Promise.all(Array.from(checkers).map(async checker => {
      const handle = checker.dataset.productHandle ||
        document.querySelector('meta[name="partmatch-handle"]')?.content ||
        window.location.pathname.split('/products/')[1]?.split('?')[0];

      if (!v || !v.year) {
        checker.innerHTML = renderFitmentState('none', null);
        return;
      }

      checker.innerHTML = renderFitmentState('loading', v);

      try {
        const result = await checkFitment(handle, v.year, v.make, v.model);
        checker.innerHTML = renderFitmentState(result.fits ? 'yes' : 'no', v);
      } catch {
        checker.innerHTML = renderFitmentState('error', v);
      }
    }));

    // Re-check when vehicle changes
    document.addEventListener('partmatch:vehicleChanged', () => initFitmentChecker());
  }

  function renderFitmentState(state, v) {
    const vehicleStr = v ? `${v.year} ${v.make} ${v.model}` : '';
    const states = {
      none: `<div class="pm-checker pm-checker--none">
               <span>Select your vehicle to check compatibility.</span>
               <a href="#partmatch-widget" class="pm-checker__link">Find your part →</a>
             </div>`,
      loading: `<div class="pm-checker pm-checker--loading">
                  <span class="pm-checker__spinner"></span>
                  <span>Checking compatibility for ${vehicleStr}…</span>
                </div>`,
      yes: `<div class="pm-checker pm-checker--yes">
              <span class="pm-checker__icon">✓</span>
              <span><strong>Yes, this product fits your ${vehicleStr}.</strong></span>
            </div>`,
      no: `<div class="pm-checker pm-checker--no">
             <span class="pm-checker__icon">✕</span>
             <span><strong>This product does not fit your ${vehicleStr}.</strong></span>
             <a href="#partmatch-widget" class="pm-checker__link">Change vehicle →</a>
           </div>`,
      error: `<div class="pm-checker pm-checker--none">
                <span>Could not verify fitment. Please try again.</span>
              </div>`,
    };
    return states[state] || states.none;
  }

  // ─── My Garage Widget ────────────────────────────────────────────────────────
  async function initGarage() {
    const garageEls = document.querySelectorAll('[data-partmatch-garage]');
    if (!garageEls.length) return;

    await loadConfig();
    if (!settingsAllow('enableGarage')) {
      garageEls.forEach(el => { el.innerHTML = ''; el.style.display = 'none'; });
      return;
    }

    garageEls.forEach(el => renderGarage(el));
    document.addEventListener('partmatch:vehicleChanged', () => {
      garageEls.forEach(el => renderGarage(el));
    });
  }

  async function renderGarage(el) {
    const garage = await getGarage();
    const current = savedVehicle();

    if (!garage.length) {
      el.innerHTML = `<p class="pm-garage__empty">No saved vehicles yet.</p>`;
      return;
    }

    const rows = garage.map(v => {
      const isActive = current && current.year === v.year && current.make === v.make && current.model === v.model;
      return `<div class="pm-garage__item${isActive ? ' pm-garage__item--active' : ''}">
        <button class="pm-garage__select" data-year="${v.year}" data-make="${v.make}" data-model="${v.model}">
          ${v.year} ${v.make} ${v.model}
          ${isActive ? '<span class="pm-garage__badge">Active</span>' : ''}
        </button>
        <button class="pm-garage__remove" data-year="${v.year}" data-make="${v.make}" data-model="${v.model}">✕</button>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="pm-garage">${rows}</div>`;

    el.querySelectorAll('.pm-garage__select').forEach(btn => {
      btn.addEventListener('click', () => {
        saveVehicle({ year: btn.dataset.year, make: btn.dataset.make, model: btn.dataset.model });
        renderGarage(el);
      });
    });

    el.querySelectorAll('.pm-garage__remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        await removeFromGarage(btn.dataset.year, btn.dataset.make, btn.dataset.model);
        const current = savedVehicle();
        if (current && current.year === btn.dataset.year && current.make === btn.dataset.make && current.model === btn.dataset.model) clearVehicle();
        renderGarage(el);
      });
    });
  }

  // ─── Standalone Search Results Page Renderer ─────────────────────────────────
  async function initStandaloneSearchResults(year, make, model) {
    let target = document.querySelector('main') || 
                 document.querySelector('#MainContent') || 
                 document.querySelector('.main-content') || 
                 document.querySelector('[role="main"]') || 
                 document.querySelector('.page-width') || 
                 document.body;

    if (!target) return;

    if (!year || !make || !model) {
      const container = document.getElementById('pm-auto-results-container');
      if (container) container.remove();
      return;
    }

    // Check if auto-results container already exists
    let container = document.getElementById('pm-auto-results-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pm-auto-results-container';
      container.className = 'pm-widget pm-standalone-results';
      container.style.cssText = 'max-width: 1280px; width: 100%; margin: 30px auto; padding: 28px; background: #ffffff; border-radius: 16px; border: 1px solid #e1e3e5; box-shadow: 0 4px 20px rgba(0,0,0,0.05); box-sizing: border-box;';
      
      container.innerHTML = `
        <div style="margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e1e3e5; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <h2 id="pm-standalone-title" style="font-size: 22px; font-weight: 700; color: #1a1a1a; margin: 0 0 4px;">
              Search Results for <span style="color: #008060;">${year} ${make} ${model}</span>
            </h2>
            <p style="color: #6d7175; margin: 0; font-size: 14px;">Showing all compatible products and universal items for your vehicle.</p>
          </div>
          <button id="pm-standalone-search-another" style="font-size: 13px; font-weight: 600; color: #008060; background: none; border: 1px solid #008060; padding: 6px 14px; border-radius: 6px; cursor: pointer; transition: background 0.2s;">
            Search Another Vehicle
          </button>
        </div>
        <div data-partmatch-auto-results>
          <div style="padding: 40px; text-align: center; color: #666;">
            <span class="pm-spinner" style="display: inline-block; width: 28px; height: 28px;"></span>
            <p style="margin-top: 12px; font-size: 14px;">Loading compatible products…</p>
          </div>
        </div>
      `;

      target.appendChild(container);

      const searchAnotherBtn = container.querySelector('#pm-standalone-search-another');
      if (searchAnotherBtn) {
        searchAnotherBtn.addEventListener('click', () => {
          clearVehicle();
          const widget = document.querySelector('[data-partmatch-widget]');
          if (widget) widget.querySelector('[data-partmatch-clear]')?.click();
        });
      }
    } else {
      const titleEl = container.querySelector('#pm-standalone-title');
      if (titleEl) titleEl.innerHTML = `Search Results for <span style="color: #008060;">${year} ${make} ${model}</span>`;
    }

    const resultsEl = container.querySelector('[data-partmatch-auto-results]');
    if (resultsEl) {
      resultsEl.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #666;">
          <span class="pm-spinner" style="display: inline-block; width: 28px; height: 28px;"></span>
          <p style="margin-top: 12px; font-size: 14px;">Loading compatible products…</p>
        </div>
      `;
      const result = await doSearch(year, make, model);
      await renderResults(resultsEl, result);
    }
  }

  // ─── Native Collection Page Filter ───────────────────────────────────────────
  async function filterNativeCollectionPage(year, make, model) {
    let matchingHandles = null;
    let matchingTitles = null;
    let matchingIds = null;
    const isReset = !year || !make || !model;

    if (!isReset) {
      const searchResult = await doSearch(year, make, model);
      if (!searchResult || !searchResult.products) return;
      matchingHandles = new Set(searchResult.products.map(p => (p.shopifyHandle || p.handle || '').toLowerCase()));
      matchingTitles = new Set(searchResult.products.map(p => (p.productTitle || p.title || '').toLowerCase()));
      matchingIds = new Set(searchResult.products.map(p => String(p.shopifyProductId || '')));
    }

    const productLinks = document.querySelectorAll('a[href*="/products/"]');
    if (!productLinks.length) return;

    const processedContainers = new Set();
    let visibleCount = 0;

    productLinks.forEach(link => {
      const container = link.closest('li.grid__item') || link.closest('.grid__item') || link.closest('.card-wrapper') || link.closest('.product-card') || link.closest('li');
      if (!container || processedContainers.has(container)) return;
      processedContainers.add(container);

      if (container.closest('.pm-standalone-results') || container.closest('.pm-widget')) return;

      if (isReset) {
        container.style.display = '';
        const badge = container.querySelector('.pm-collection-fitment-badge');
        if (badge) badge.remove();
      } else {
        const href = link.getAttribute('href') || '';
        let handle = '';
        if (href.includes('/products/')) {
          const parts = href.split('/products/')[1];
          if (parts) handle = parts.split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase();
        }

        const titleEl = container.querySelector('.card__heading, .full-unstyled-link, .product-card__title, h3, h2, a');
        const title = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
        const prodId = container.dataset.productId || link.dataset.productId || '';

        const isMatch = (handle && matchingHandles.has(handle)) || 
                        (title && matchingTitles.has(title)) || 
                        (prodId && matchingIds.has(prodId));

        if (isMatch) {
          container.style.display = '';
          visibleCount++;

          if (!container.querySelector('.pm-collection-fitment-badge')) {
            const badge = document.createElement('div');
            badge.className = 'pm-collection-fitment-badge';
            badge.style.cssText = 'display: inline-block; margin: 6px 0; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 12px; background: #e6f4ea; color: #137333;';
            badge.textContent = `✓ Fits ${year} ${make} ${model}`;
            if (titleEl && titleEl.parentNode) {
              titleEl.parentNode.insertBefore(badge, titleEl.nextSibling);
            }
          }
        } else {
          container.style.display = 'none';
        }
      }
    });

    const countLabel = document.getElementById('ProductCount') || document.querySelector('.product-count') || document.getElementById('ProductCountDesktop');
    if (countLabel) {
      if (isReset) {
        countLabel.textContent = '';
      } else {
        countLabel.textContent = `${visibleCount} products matching ${year} ${make} ${model}`;
      }
    }
  }

  // Helper to re-evaluate and apply collection page filter
  function handleCollectionPageFilter() {
    const isCollectionPage = window.location.pathname.includes('/collections') || window.location.pathname.includes('/search');
    if (!isCollectionPage) return;

    const urlParams = new URLSearchParams(window.location.search);
    const urlYear  = urlParams.get('year');
    const urlMake  = urlParams.get('make');
    const urlModel = urlParams.get('model');

    const saved = settingsAllow('persistSelection') ? savedVehicle() : null;
    const v = (urlYear && urlMake && urlModel) ? { year: urlYear, make: urlMake, model: urlModel } : saved;

    if (v && v.year && v.make && v.model) {
      filterNativeCollectionPage(v.year, v.make, v.model);
    } else {
      filterNativeCollectionPage(null, null, null);
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    const widgets = document.querySelectorAll('[data-partmatch-widget]');
    widgets.forEach(initSearchWidget);

    loadConfig().then(() => {
      handleCollectionPageFilter();

      // Listen to changes to re-filter
      document.addEventListener('partmatch:vehicleChanged', () => {
        handleCollectionPageFilter();
      });

      // If widgets.length === 0 and there is a vehicle, show standalone results
      const isCollectionPage = window.location.pathname.includes('/collections') || window.location.pathname.includes('/search');
      if (!isCollectionPage && widgets.length === 0) {
        const handleStandalone = () => {
          const urlParams = new URLSearchParams(window.location.search);
          const urlYear  = urlParams.get('year');
          const urlMake  = urlParams.get('make');
          const urlModel = urlParams.get('model');
          const saved = settingsAllow('persistSelection') ? savedVehicle() : null;
          const v = (urlYear && urlMake && urlModel) ? { year: urlYear, make: urlMake, model: urlModel } : saved;

          if (v && v.year && v.make && v.model) {
            initStandaloneSearchResults(v.year, v.make, v.model);
          } else {
            initStandaloneSearchResults(null, null, null);
          }
        };

        handleStandalone();
        document.addEventListener('partmatch:vehicleChanged', handleStandalone);
      }
    });

    initVehicleBar();
    initFitmentChecker();
    initGarage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API
  window.PartMatch = { savedVehicle, saveVehicle, clearVehicle, getGarage, addToGarage };
})();
