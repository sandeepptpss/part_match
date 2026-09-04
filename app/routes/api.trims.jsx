const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/trims?year=&make=&model= (proxied storefront request)
export async function loader({ request }) {
  let shop = null;
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session?.shop) shop = session.shop;
  } catch (err) {
    // Ignore proxy auth error and fallback to query params/database
  }

  if (!shop) {
    const url = new URL(request.url);
    const paramShop = url.searchParams.get("shop");
    if (paramShop && typeof paramShop === "string") {
      shop = paramShop.trim();
    }
  }

  if (!shop) {
    return json({ trims: [], hasTrims: false });
  }

  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");

  if (!year || !make || !model) {
    return json({ error: "Missing required fields: year, make, model", trims: [], hasTrims: false }, { status: 400 });
  }

  try {
    const trims = await prisma.fitmentRecord?.findMany({
      where: {
        shop,
        year,
        make,
        model,
        trim: { not: "" },
        OR: [
          { products: { some: {} } },
          { collections: { some: {} } },
          { tags: { some: {} } },
          { skus: { some: {} } },
        ],
      },
      select: { trim: true },
      distinct: ["trim"],
      orderBy: { trim: "asc" },
    });

    const trimList = (trims || []).map((r) => r.trim).filter(Boolean);

    return json({ trims: trimList, hasTrims: trimList.length > 0 });
  } catch (err) {
    console.error("[api/trims]", err);
    return json({ trims: [], hasTrims: false });
  }
}
