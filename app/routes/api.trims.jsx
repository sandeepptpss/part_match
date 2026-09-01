const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/trims?year=&make=&model= (proxied storefront request)
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const year = url.searchParams.get("year");
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");

  if (!year || !make || !model) {
    return json({ error: "Missing required fields: year, make, model" }, { status: 400 });
  }

  try {
    const trims = await prisma.fitmentRecord?.findMany({
      where: {
        shop,
        year,
        make,
        model,
        trim: { not: "" },
      },
      select: { trim: true },
      distinct: ["trim"],
      orderBy: { trim: "asc" },
    });

    const trimList = (trims || []).map((r) => r.trim).filter(Boolean);

    return json({ trims: trimList, hasTrims: trimList.length > 0 });
  } catch (err) {
    console.error("[api/trims]", err);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
