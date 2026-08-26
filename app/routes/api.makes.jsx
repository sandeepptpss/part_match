const json = (data, init) => Response.json(data, init);
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// GET /apps/partmatch/api/makes?year= (proxied storefront request)
export async function loader({ request }) {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = session.shop;
  const url = new URL(request.url);
  const year = url.searchParams.get("year");

  if (!year) {
    return json({ error: "Missing year" }, { status: 400 });
  }

  try {
    const makes = await prisma.fitmentRecord?.findMany({
      where: { shop, year },
      select: { make: true },
      distinct: ["make"],
      orderBy: { make: "asc" },
    });

    return json({ makes: makes.map((r) => r.make) });
  } catch (err) {
    console.error("[api/makes]", err);
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
