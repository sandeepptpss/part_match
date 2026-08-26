const json = (data, init) => Response.json(data, init);
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let fitmentCount = 0;
  let productMappingCount = 0;
  let universalCount = 0;
  let monthSearches = 0;
  let noResultSearches = 0;
  let recentSearches = [];
  let topVehicles = [];

  try {
    const res = await Promise.all([
      prisma.fitmentRecord?.count({ where: { shop } }) ?? 0,
      prisma.fitmentProduct?.count({ where: { fitment: { shop } } }) ?? 0,
      prisma.universalProduct?.count({ where: { shop } }) ?? 0,
      prisma.searchLog?.count({
        where: { shop, createdAt: { gte: new Date(new Date().setDate(1)) } },
      }) ?? 0,
      prisma.searchLog?.count({ where: { shop, hasResults: false } }) ?? 0,
      prisma.searchLog?.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { year: true, make: true, model: true, hasResults: true, createdAt: true },
      }) ?? [],
      prisma.searchLog?.groupBy({
        by: ["year", "make", "model"],
        where: { shop },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }) ?? [],
    ]);
    [
      fitmentCount,
      productMappingCount,
      universalCount,
      monthSearches,
      noResultSearches,
      recentSearches,
      topVehicles,
    ] = res;
  } catch (err) {
    console.error("[Dashboard loader error]", err);
  }

  return json({
    shop,
    stats: { fitmentCount, productMappingCount, universalCount, monthSearches, noResultSearches },
    recentSearches,
    topVehicles,
  });
};

export default function Dashboard() {
  const { shop, stats, recentSearches, topVehicles } = useLoaderData();

  const cards = [
    { label: "Fitment Records", value: stats.fitmentCount, href: "/app/fitment", color: "#008060" },
    { label: "Product Mappings", value: stats.productMappingCount, href: "/app/products", color: "#2c6ecb" },
    { label: "Universal Products", value: stats.universalCount, href: "/app/products/universal", color: "#6d5bd0" },
    { label: "Searches This Month", value: stats.monthSearches, href: "/app/analytics", color: "#e67e22" },
    { label: "No-Result Searches", value: stats.noResultSearches, href: "/app/analytics", color: "#c0392b" },
  ];

  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "700", margin: 0 }}>PartMatch Dashboard</h1>
        <p style={{ color: "#6d7175", marginTop: "4px" }}>{shop}</p>
      </div>

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "28px", flexWrap: "wrap" }}>
        <a href="/app/fitment/add" style={btnStyle("#008060")}>+ Add Fitment Record</a>
        <a href="/app/fitment/import" style={btnStyle("#2c6ecb")}>↑ Import CSV</a>
        <a href="/app/widget" style={btnStyle("#6d5bd0")}>Customize Widget</a>
        <a href="/app/analytics" style={btnStyle("#e67e22")}>View Analytics</a>
      </div>

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: "16px", marginBottom: "32px" }}>
        {cards.map((c) => (
          <a key={c.label} href={c.href} style={{ textDecoration: "none" }}>
            <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "20px", borderTop: `4px solid ${c.color}` }}>
              <div style={{ fontSize: "32px", fontWeight: "700", color: c.color }}>{c.value}</div>
              <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>{c.label}</div>
            </div>
          </a>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", flexWrap: "wrap" }}>
        {/* Top Vehicles */}
        <div style={cardStyle}>
          <h3 style={sectionHead}>Top Searched Vehicles</h3>
          {topVehicles.length === 0 ? (
            <p style={{ color: "#6d7175" }}>No searches yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <th style={th}>Vehicle</th>
                  <th style={{ ...th, textAlign: "right" }}>Searches</th>
                </tr>
              </thead>
              <tbody>
                {topVehicles.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={td}>{v.year} {v.make} {v.model}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: "600" }}>{v._count.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Searches */}
        <div style={cardStyle}>
          <h3 style={sectionHead}>Recent Searches</h3>
          {recentSearches.length === 0 ? (
            <p style={{ color: "#6d7175" }}>No searches yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <th style={th}>Vehicle</th>
                  <th style={{ ...th, textAlign: "center" }}>Result</th>
                  <th style={{ ...th, textAlign: "right" }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentSearches.map((s, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={td}>{s.year} {s.make} {s.model}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{
                        background: s.hasResults ? "#d4edda" : "#f8d7da",
                        color: s.hasResults ? "#155724" : "#721c24",
                        padding: "2px 8px", borderRadius: "10px", fontSize: "12px"
                      }}>
                        {s.hasResults ? "Found" : "No Result"}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "right", color: "#6d7175", fontSize: "12px" }}>
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Getting Started */}
      {stats.fitmentCount === 0 && (
        <div style={{ marginTop: "24px", background: "#f0f7ff", border: "1px solid #b3d4f5", borderRadius: "8px", padding: "20px" }}>
          <h3 style={{ margin: "0 0 12px" }}>🚀 Getting Started</h3>
          <ol style={{ paddingLeft: "20px", lineHeight: "2" }}>
            <li><a href="/app/fitment/add">Add fitment records</a> (Year / Make / Model)</li>
            <li><a href="/app/fitment/import">Import a CSV</a> to bulk-load your fitment data</li>
            <li><a href="/app/products">Assign products</a> to fitment records</li>
            <li><a href="/app/widget">Customize the search widget</a> for your store</li>
          </ol>
        </div>
      )}
    </div>
  );
}

const btnStyle = (bg) => ({
  display: "inline-block",
  background: bg,
  color: "#fff",
  padding: "8px 16px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "500",
});

const cardStyle = {
  background: "#fff",
  border: "1px solid #e1e3e5",
  borderRadius: "8px",
  padding: "20px",
};

const sectionHead = {
  fontSize: "16px",
  fontWeight: "600",
  margin: "0 0 16px",
};

const th = {
  textAlign: "left",
  padding: "8px 4px",
  fontSize: "13px",
  color: "#6d7175",
  fontWeight: "500",
};

const td = {
  padding: "10px 4px",
  fontSize: "14px",
};
