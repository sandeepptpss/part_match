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
  primaryColor: "#0f172a",
  textColor: "#0f172a",
  backgroundColor: "#ffffff",
  borderRadius: 6,
  layout: "horizontal",
  showHeading: true,
  showSubheading: true,
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
  } else {
    widget = {
      ...widget,
      heading: widget.heading === "Find Your Part" ? "FIND YOUR PART" : widget.heading,
      subheading: widget.subheading === "Search by Application" ? "SEARCH BY APPLICATION" : widget.subheading,
      yearLabel: widget.yearLabel === "Year" ? "YEAR" : widget.yearLabel,
      makeLabel: widget.makeLabel === "Make" ? "MAKE" : widget.makeLabel,
      modelLabel: widget.modelLabel === "Model" ? "MODEL" : widget.modelLabel,
      searchButtonText: widget.searchButtonText === "Search" ? "SEARCH" : widget.searchButtonText,
      clearButtonText: widget.clearButtonText === "Clear" ? "CLEAR" : widget.clearButtonText,
      primaryColor: (!widget.primaryColor || widget.primaryColor === "#008060" || widget.primaryColor === "#934b17" || widget.primaryColor.startsWith("#eb") || widget.primaryColor.startsWith("#e2") || widget.primaryColor.startsWith("#e5")) ? "#0f172a" : widget.primaryColor,
      backgroundColor: (widget.backgroundColor === "#f4f6f8" || widget.backgroundColor === "#1a1a1a") ? "#ffffff" : widget.backgroundColor,
      textColor: (widget.backgroundColor === "#ffffff" || !widget.backgroundColor) ? "#0f172a" : widget.textColor,
    };
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
