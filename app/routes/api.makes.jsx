const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

async function getShopFromRequest(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (session?.shop) return session.shop;
  } catch (err) {}

  const url = new URL(request.url);
  const paramShop = url.searchParams.get("shop");
  if (paramShop) return paramShop;

  const firstRecord = await prisma.fitmentRecord.findFirst({ select: { shop: true } });
  if (firstRecord?.shop) return firstRecord.shop;

  const firstSettings = await prisma.appSettings.findFirst({ select: { shop: true } });
  if (firstSettings?.shop) return firstSettings.shop;

  return null;
}

// GET /apps/partmatch/api/makes?year= (proxied storefront request)
export async function loader({ request }) {
  const shop = await getShopFromRequest(request);

  const url = new URL(request.url);
  const year = url.searchParams.get("year");

  if (!shop || !year) {
    return json({ makes: [] });
  }

  try {
    const records = await prisma.fitmentRecord?.findMany({
      where: { shop, year },
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
