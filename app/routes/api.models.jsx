const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/models?year=&make= (proxied storefront request)
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
  const make = url.searchParams.get("make");

  if (!shop || !year || !make) {
    return json({ models: [] });
  }

  try {
    // Only return Models for fitments that have at least 1 mapped product, collection, tag, or SKU
    const fitments = await prisma.fitmentRecord?.findMany({
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
      select: { make: true, model: true },
    });

    const targetMake = (make || "").trim().toLowerCase();

    const matchedModels = (fitments || [])
      .filter((r) => (r.make || "").trim().toLowerCase() === targetMake)
      .map((r) => r.model)
      .filter(Boolean);

    const uniqueModels = Array.from(new Set(matchedModels)).sort();

    return json({ models: uniqueModels });
  } catch (err) {
    console.error("[api/models]", err);
    return json({ models: [] });
  }
}
