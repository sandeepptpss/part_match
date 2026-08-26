const json = (data, init) => Response.json(data, init);
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalSearches,
    successfulSearches,
    noResultSearches,
    topVehicles,
    noResultVehicles,
    dailySearches,
  ] = await Promise.all([
    prisma.searchLog?.count({ where: { shop } }),
    prisma.searchLog?.count({ where: { shop, hasResults: true } }),
    prisma.searchLog?.count({ where: { shop, hasResults: false } }),
    prisma.searchLog?.groupBy({
      by: ["year", "make", "model"],
      where: { shop },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prisma.searchLog?.groupBy({
      by: ["year", "make", "model"],
      where: { shop, hasResults: false },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
    prisma.$queryRaw`
      SELECT DATE(createdAt) as date, COUNT(*) as count
      FROM SearchLog
      WHERE shop = ${shop} AND createdAt >= ${thirtyDaysAgo}
      GROUP BY DATE(createdAt)
      ORDER BY date ASC
    `,
  ]);

  const successRate = totalSearches > 0 ? Math.round((successfulSearches / totalSearches) * 100) : 0;

  return json({
    stats: { totalSearches, successfulSearches, noResultSearches, successRate },
    topVehicles,
    noResultVehicles,
    dailySearches: dailySearches.map((r) => ({
      date: r.date?.toISOString?.()?.slice(0, 10) ?? String(r.date),
      count: Number(r.count),
    })),
  });
};

export default function Analytics() {
  const { stats, topVehicles, noResultVehicles, dailySearches } = useLoaderData();

  const cards = [
    { label: "Total Searches", value: stats.totalSearches, color: "#2c6ecb" },
    { label: "Successful Searches", value: stats.successfulSearches, color: "#008060" },
    { label: "No-Result Searches", value: stats.noResultSearches, color: "#c0392b" },
    { label: "Success Rate", value: `${stats.successRate}%`, color: "#e67e22" },
  ];

  const maxDailyCount = Math.max(...dailySearches.map((d) => d.count), 1);

  return (
    <div style={{ padding: "20px", maxWidth: "1100px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "22px", fontWeight: "700", margin: "0 0 24px" }}>Analytics</h1>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: "16px", marginBottom: "32px" }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "20px", borderTop: `4px solid ${c.color}` }}>
            <div style={{ fontSize: "32px", fontWeight: "700", color: c.color }}>{c.value}</div>
            <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "4px" }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Daily Chart (simple bar) */}
      {dailySearches.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: "24px" }}>
          <h3 style={sectionHead}>Daily Searches (Last 30 Days)</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "100px", overflowX: "auto" }}>
            {dailySearches.map((d) => (
              <div key={d.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                <div
                  title={`${d.date}: ${d.count} searches`}
                  style={{
                    width: "24px",
                    height: `${Math.round((d.count / maxDailyCount) * 80)}px`,
                    background: "#2c6ecb",
                    borderRadius: "3px 3px 0 0",
                    minHeight: "4px",
                  }}
                />
                <div style={{ fontSize: "9px", color: "#6d7175", marginTop: "2px", transform: "rotate(-45deg)", width: "24px" }}>
                  {d.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        {/* Top Vehicles */}
        <div style={cardStyle}>
          <h3 style={sectionHead}>Top Searched Vehicles</h3>
          {topVehicles.length === 0 ? (
            <p style={{ color: "#6d7175" }}>No searches yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                <th style={th}>#</th>
                <th style={th}>Vehicle</th>
                <th style={{ ...th, textAlign: "right" }}>Searches</th>
              </tr></thead>
              <tbody>
                {topVehicles.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ ...td, color: "#6d7175", width: "30px" }}>{i + 1}</td>
                    <td style={td}>{v.year} {v.make} {v.model}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: "600" }}>{v._count.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* No-Result Vehicles */}
        <div style={cardStyle}>
          <h3 style={{ ...sectionHead, color: "#c0392b" }}>No-Result Searches (Opportunity Gap)</h3>
          <p style={{ fontSize: "13px", color: "#6d7175", margin: "0 0 12px" }}>
            These vehicles are being searched but have no mapped products.
          </p>
          {noResultVehicles.length === 0 ? (
            <p style={{ color: "#6d7175" }}>No no-result searches! 🎉</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                <th style={th}>Vehicle</th>
                <th style={{ ...th, textAlign: "right" }}>Count</th>
                <th style={{ ...th, textAlign: "right" }}>Action</th>
              </tr></thead>
              <tbody>
                {noResultVehicles.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={td}>{v.year} {v.make} {v.model}</td>
                    <td style={{ ...td, textAlign: "right", color: "#c0392b", fontWeight: "600" }}>{v._count.id}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <a
                        href={`/app/fitment/add?year=${v.year}&make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}`}
                        style={{ color: "#008060", fontSize: "13px" }}
                      >
                        Add →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const cardStyle = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "20px" };
const sectionHead = { fontSize: "16px", fontWeight: "600", margin: "0 0 16px" };
const th = { padding: "8px 4px", textAlign: "left", fontSize: "13px", color: "#6d7175", fontWeight: "500" };
const td = { padding: "10px 4px", fontSize: "14px" };
