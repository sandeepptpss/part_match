const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_VEHICLES = 5;

// Shopify's App Proxy signs and forwards `logged_in_customer_id` automatically
// when the storefront request came from a page with a logged-in customer.
// Guests have no customer id — My Garage falls back to localStorage for them.
function getCustomerId(url) {
  return url.searchParams.get("logged_in_customer_id") || null;
}

// GET /apps/partmatch/api/garage
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const customerId = getCustomerId(url);

  if (!customerId) {
    return json({ loggedIn: false, vehicles: [] });
  }

  const vehicles = await prisma.savedVehicle?.findMany({
    where: { shop: session.shop, customerId },
    orderBy: { createdAt: "desc" },
    select: { year: true, make: true, model: true },
  });

  return json({ loggedIn: true, vehicles: vehicles ?? [] });
}

// POST /apps/partmatch/api/garage  body: { intent: "add"|"remove", year, make, model }
export async function action({ request }) {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const customerId = getCustomerId(url);
  if (!customerId) {
    return json({ error: "Not logged in" }, { status: 401 });
  }

  const shop = session.shop;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { intent, year, make, model } = body;
  if (!year || !make || !model) {
    return json({ error: "Missing year, make, or model" }, { status: 400 });
  }

  if (intent === "add") {
    const count = await prisma.savedVehicle?.count({ where: { shop, customerId } });
    if (count >= MAX_VEHICLES) {
      return json({ error: `Garage is full (max ${MAX_VEHICLES} vehicles)` }, { status: 400 });
    }
    await prisma.savedVehicle?.upsert({
      where: { shop_customerId_year_make_model: { shop, customerId, year, make, model } },
      create: { shop, customerId, year, make, model },
      update: {},
    });
  }

  if (intent === "remove") {
    await prisma.savedVehicle?.deleteMany({ where: { shop, customerId, year, make, model } });
  }

  const vehicles = await prisma.savedVehicle?.findMany({
    where: { shop, customerId },
    orderBy: { createdAt: "desc" },
    select: { year: true, make: true, model: true },
  });

  return json({ loggedIn: true, vehicles: vehicles ?? [] });
}
