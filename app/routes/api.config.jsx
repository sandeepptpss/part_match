const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

const DEFAULT_WIDGET_SETTINGS = {
  heading: "FIND YOUR PART",
  subheading: "SEARCH BY APPLICATION",
  yearLabel: "YEAR",
  makeLabel: "MAKE",
  modelLabel: "MODEL",
  searchButtonText: "SEARCH",
  clearButtonText: "CLEAR",
  voiceSearchButtonText: "ASK AI",
  voiceSearchTabText: "AI VOICE SEARCH",
  voiceSearchPlaceholder: "e.g. Front brake pads for 2018 Honda Civic EX...",
  primaryColor: "#0f172a",
  textColor: "#ffffff",
  backgroundColor: "#ffffff",
  borderRadius: 6,
  layout: "horizontal",
  showHeading: true,
  showSubheading: true,
  enableVinSearch: true,
  enableYmmSearch: true,
  enableVoiceSearch: false,
};

const DEFAULT_APP_SETTINGS = {
  requireYear: true,
  requireAllFields: true,
  logNoResults: true,
  includeUniversal: true,
  redirectOnSearch: true,
  resultsUrl: "/collections/all",
  persistSelection: true,
  enableGarage: true,
  showFitmentChecker: true,
};

async function getShopFromReq(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session?.shop) return session.shop;
  } catch (err) {
    // App proxy signature missing or in theme editor preview
  }
  try {
    const url = new URL(request.url);
    const queryShop = url.searchParams.get("shop");
    if (queryShop) return queryShop;
  } catch {}
  return null;
}

// GET /apps/partmatch/api/config
// Returns the merchant's saved widget appearance + app behavior settings
// so the storefront widget reflects what was configured in the admin app.
export async function loader({ request }) {
  const shop = await getShopFromReq(request);

  if (!shop) {
    return json({
      widget: DEFAULT_WIDGET_SETTINGS,
      settings: DEFAULT_APP_SETTINGS,
      limits: { universalProducts: true, fitmentChecker: true, vinLookup: true, voiceSearchAssistant: true, subModelTrim: true },
    });
  }

  let widget = await prisma.widgetSettings?.findUnique({ where: { shop } });
  if (!widget) {
    widget = { shop, ...DEFAULT_WIDGET_SETTINGS };
  }

  let appSettings = await prisma.appSettings?.findUnique({ where: { shop } });
  if (!appSettings) {
    appSettings = { shop, ...DEFAULT_APP_SETTINGS };
  }

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  const maskedWidget = widget
    ? {
        ...widget,
        enableVinSearch: Boolean(widget.enableVinSearch && limits.vinLookup),
        enableVoiceSearch: Boolean(widget.enableVoiceSearch && limits.voiceSearchAssistant),
      }
    : null;

  const settings = appSettings
    ? {
        requireYear: appSettings.requireYear,
        requireAllFields: appSettings.requireAllFields,
        logNoResults: appSettings.logNoResults,
        includeUniversal: appSettings.includeUniversal,
        redirectOnSearch: appSettings.redirectOnSearch,
        resultsUrl: appSettings.resultsUrl,
        persistSelection: appSettings.persistSelection,
        enableGarage: appSettings.enableGarage,
        enablePdpBadges: appSettings.enablePdpBadges,
        showFitmentChecker: Boolean(appSettings.showFitmentChecker && limits.fitmentChecker),
        enableTrim: Boolean(appSettings.enableTrim !== false && limits.subModelTrim !== false),
        enableVinSearch: Boolean(appSettings.enableVinSearch && limits.vinLookup),
        vinCapEnabled: appSettings.vinCapEnabled,
        vinMonthlyCapLimit: appSettings.vinMonthlyCapLimit,
      }
    : null;

  return json({
    widget: maskedWidget,
    settings,
    limits,
  });
}
