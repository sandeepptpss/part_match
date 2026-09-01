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

// GET /apps/partmatch/api/years (proxied storefront request)
export async function loader({ request }) {
  const shop = await getShopFromRequest(request);

  if (!shop) {
    return json({ years: [] });
  }

  try {
    const years = await prisma.fitmentRecord?.findMany({
      where: { shop },
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "desc" },
    });

    return json({ years: years.map((r) => r.year) });
  } catch (err) {
    console.error("[api/years]", err);
    return json({ years: [] });
  }
}
