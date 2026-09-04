const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/years (proxied storefront request)
export async function loader({ request }) {
  async function getShopFromRequest(req) {
    try {
      const { session } = await authenticate.public.appProxy(req);
      if (session?.shop) return session.shop;
    } catch (err) {
      // App Proxy signature missing or invalid
    }
    return null;
  }

  const shop = await getShopFromRequest(request);

  if (!shop) {
    return json({ years: [] });
  }

  try {
    // Only return Years for fitments that have at least 1 mapped product, collection, tag, or SKU
    const years = await prisma.fitmentRecord?.findMany({
      where: {
        shop,
        OR: [
          { products: { some: {} } },
          { collections: { some: {} } },
          { tags: { some: {} } },
          { skus: { some: {} } },
        ],
      },
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "desc" },
    });

    return json({ years: (years || []).map((r) => r.year) });
  } catch (err) {
    console.error("[api/years]", err);
    return json({ years: [] });
  }
}
