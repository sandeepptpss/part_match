const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

const MAX_VEHICLES = 5;

// Shopify's App Proxy signs and forwards `logged_in_customer_id` automatically
// when the storefront request came from a page with a logged-in customer.
// Guests have no customer id — My Garage falls back to localStorage for them.
function getCustomerId(url) {
  return url.searchParams.get("logged_in_customer_id") || null;
}

async function getShopAndAuth(request) {
  let shop = null;
  let isVerifiedProxy = false;
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session?.shop) {
      shop = session.shop;
      isVerifiedProxy = true;
    }
  } catch (err) {
    // App proxy signature missing in standalone simulation or dev preview
  }
  // Only allow ?shop= / body.shop fallback in development (never in production)
  if (!shop && process.env.NODE_ENV !== "production") {
    try {
      const url = new URL(request.url);
      const queryShop = url.searchParams.get("shop");
      if (queryShop) shop = queryShop;
      else if (request.method === "POST") {
        const cloned = request.clone();
        const body = await cloned.json().catch(() => ({}));
        if (body?.shop) shop = body.shop;
      }
    } catch {}
  }
  return { shop, isVerifiedProxy };
}

// GET /apps/partmatch/api/garage
export async function loader({ request }) {
  const { shop, isVerifiedProxy } = await getShopAndAuth(request);
  if (!shop) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const customerId = getCustomerId(url);

  if (!customerId) {
    return json({ loggedIn: false, vehicles: [] });
  }

  // Security check: in production, require verified App Proxy HMAC signature to trust logged_in_customer_id
  if (process.env.NODE_ENV === "production" && !isVerifiedProxy) {
    return json({ error: "Forbidden: Direct access without Shopify App Proxy signature is rejected." }, { status: 403 });
  }

  const { plan } = await getShopPlan(shop);
  if (!planLimits(plan).garageSync) {
    // Server-side garage sync requires Growth+. Same shape as "guest" so the
    // widget falls back to localStorage automatically.
    return json({ loggedIn: false, vehicles: [] });
  }

  const vehicles = await prisma.savedVehicle?.findMany({
    where: { shop, customerId: String(customerId).trim().slice(0, 100) },
    orderBy: { createdAt: "desc" },
    select: { year: true, make: true, model: true, trim: true },
  });

  return json({ loggedIn: true, vehicles: vehicles ?? [] });
}

// POST /apps/partmatch/api/garage  body: { intent: "add"|"remove", year, make, model, trim }
export async function action({ request }) {
  const { shop, isVerifiedProxy } = await getShopAndAuth(request);
  if (!shop) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const customerId = getCustomerId(url);
  if (!customerId) {
    return json({ error: "Not logged in" }, { status: 401 });
  }

  // Security check: in production, require verified App Proxy HMAC signature to trust logged_in_customer_id
  if (process.env.NODE_ENV === "production" && !isVerifiedProxy) {
    return json({ error: "Forbidden: Direct access without Shopify App Proxy signature is rejected." }, { status: 403 });
  }

  const { plan } = await getShopPlan(shop);
  if (!planLimits(plan).garageSync) {
    return json({ error: "My Garage sync requires the Growth Professional plan or above." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { intent, year, make, model, trim = "" } = body;
  if (!year || !make || !model) {
    return json({ error: "Missing year, make, or model" }, { status: 400 });
  }

  const cleanYear = String(year).trim().slice(0, 50);
  const cleanMake = String(make).trim().slice(0, 100);
  const cleanModel = String(model).trim().slice(0, 100);
  const cleanTrim = String(trim || "").trim().slice(0, 100);
  const cleanCustId = String(customerId).trim().slice(0, 100);

  if (intent === "add") {
    const count = await prisma.savedVehicle?.count({ where: { shop, customerId: cleanCustId } });
    if (count >= MAX_VEHICLES) {
      return json({ error: `Garage is full (max ${MAX_VEHICLES} vehicles)` }, { status: 400 });
    }
    await prisma.savedVehicle?.upsert({
      where: {
        shop_customerId_year_make_model_trim: {
          shop,
          customerId: cleanCustId,
          year: cleanYear,
          make: cleanMake,
          model: cleanModel,
          trim: cleanTrim,
        },
      },
      create: { shop, customerId: cleanCustId, year: cleanYear, make: cleanMake, model: cleanModel, trim: cleanTrim },
      update: {},
    });
  }

  if (intent === "remove") {
    await prisma.savedVehicle?.deleteMany({
      where: {
        shop,
        customerId: cleanCustId,
        year: cleanYear,
        make: cleanMake,
        model: cleanModel,
        ...(cleanTrim ? { trim: cleanTrim } : {}),
      },
    });
  }

  const vehicles = await prisma.savedVehicle?.findMany({
    where: { shop, customerId: cleanCustId },
    orderBy: { createdAt: "desc" },
    select: { year: true, make: true, model: true, trim: true },
  });

  return json({ loggedIn: true, vehicles: vehicles ?? [] });
}
