const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

const DEFAULT_WIDGET_SETTINGS = {
  heading: "Find Your Part",
  subheading: "Search by Application",
  yearLabel: "Year",
  makeLabel: "Make",
  modelLabel: "Model",
  searchButtonText: "Search",
  clearButtonText: "Clear",
  primaryColor: "#008060",
  textColor: "#ffffff",
  backgroundColor: "#f4f6f8",
  borderRadius: 4,
  layout: "horizontal",
  showHeading: true,
  showSubheading: true,
};

const DEFAULT_APP_SETTINGS = {
  requireYear: true,
  requireAllFields: true,
  logNoResults: true,
  includeUniversal: true,
  redirectOnSearch: false,
  resultsUrl: "/pages/find-your-part",
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
  });
}
