const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/makes?year= (proxied storefront request)
export async function loader({ request }) {
  async function getShopFromRequest(req) {
    try {
      const { session } = await authenticate.public.appProxy(req);
      if (session?.shop) return session.shop;
    } catch (err) {
      // App Proxy signature missing or invalid
    }
    try {
      const url = new URL(req.url);
      const queryShop = url.searchParams.get("shop");
      if (queryShop) return queryShop;
    } catch {}
    return null;
  }

  const shop = await getShopFromRequest(request);

  const url = new URL(request.url);
  const year = url.searchParams.get("year");

  if (!shop) {
    return json({ makes: [] });
  }

  const appSettings = await prisma.appSettings?.findUnique({ where: { shop } });
  const requireYear = appSettings?.requireYear !== false;

  if (requireYear && !year) {
    return json({ makes: [] });
  }

  try {
    // Only return Makes for fitments that have at least 1 mapped product, collection, tag, or SKU
    const whereClause = {
      shop,
      ...(year ? { year } : {}),
      OR: [
        { products: { some: {} } },
        { collections: { some: {} } },
        { tags: { some: {} } },
        { skus: { some: {} } },
      ],
    };
    const records = await prisma.fitmentRecord?.findMany({
      where: whereClause,
      select: { make: true },
    });

    const rawMakes = (records || []).map((r) => r.make).filter(Boolean);
    const uniqueMakes = Array.from(new Set(rawMakes)).sort();

    return json({ makes: uniqueMakes });
  } catch (err) {
    console.error("[api/makes]", err);
    return json({ makes: [] });
  }
}
