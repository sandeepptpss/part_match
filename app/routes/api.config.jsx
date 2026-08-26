const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

// GET /apps/partmatch/api/config
// Returns the merchant's saved widget appearance + app behavior settings
// so the storefront widget reflects what was configured in the admin app.
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;

  let widget = await prisma.widgetSettings?.findFirst({ where: { shop } });
  if (!widget) widget = await prisma.widgetSettings?.findFirst();

  let appSettings = await prisma.appSettings?.findFirst({ where: { shop } });
  if (!appSettings) appSettings = await prisma.appSettings?.findFirst();

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  const settings = appSettings
    ? { ...appSettings, showFitmentChecker: appSettings.showFitmentChecker && limits.fitmentChecker }
    : null;

  return json({
    widget: widget ?? null,
    settings,
  });
}
