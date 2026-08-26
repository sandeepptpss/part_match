const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/fitment-check?handle=&year=&make=&model=
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized", fits: false }, { status: 401 });
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle");
  const year = url.searchParams.get("year");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");

  if (!handle || !year || !make || !model) {
    return json({ error: "Missing parameters", fits: false }, { status: 400 });
  }

  const appSettings = await prisma.appSettings?.findUnique({ where: { shop } });
  const includeUniversal = appSettings?.includeUniversal ?? true;

  // Check if product is universal
  if (includeUniversal) {
    const universal = await prisma.universalProduct?.findFirst({
      where: { shop, shopifyHandle: handle },
    });
    if (universal) {
      return json({ fits: true, reason: "universal" });
    }
  }

  // Check fitment mapping
  const fitment = await prisma.fitmentRecord?.findUnique({
    where: { shop_year_make_model: { shop, year, make, model } },
    include: {
      products: {
        where: { shopifyHandle: handle },
        take: 1,
      },
    },
  });

  const fits = (fitment?.products?.length ?? 0) > 0;
  return json({ fits, fitmentId: fitment?.id ?? null });
}
