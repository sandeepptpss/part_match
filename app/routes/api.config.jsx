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

// GET /apps/partmatch/api/config
// Returns the merchant's saved widget appearance + app behavior settings
// so the storefront widget reflects what was configured in the admin app.
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;

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

  const settings = appSettings
    ? { ...appSettings, showFitmentChecker: appSettings.showFitmentChecker && limits.fitmentChecker }
    : null;

  return json({
    widget,
    settings,
    limits,
  });
}
