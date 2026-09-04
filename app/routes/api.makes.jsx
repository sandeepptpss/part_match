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
      // Ignore proxy auth error and fallback to query params/database
    }

    const url = new URL(req.url);
    const paramShop = url.searchParams.get("shop");
    if (paramShop && typeof paramShop === "string") {
      return paramShop.trim();
    }

    return null;
  }

  const shop = await getShopFromRequest(request);

  const url = new URL(request.url);
  const year = url.searchParams.get("year");

  if (!shop || !year) {
    return json({ makes: [] });
  }

  try {
    // Only return Makes for fitments that have at least 1 mapped product, collection, tag, or SKU
    const records = await prisma.fitmentRecord?.findMany({
      where: {
        shop,
        year,
        OR: [
          { products: { some: {} } },
          { collections: { some: {} } },
          { tags: { some: {} } },
          { skus: { some: {} } },
        ],
      },
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
