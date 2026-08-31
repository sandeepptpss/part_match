const json = (data, init) => Response.json(data, init);
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);
  const detailed = limits.analyticsDetail === "detailed";

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
    detailed
      ? prisma.searchLog?.groupBy({
          by: ["year", "make", "model"],
          where: { shop },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        })
      : [],
    detailed
      ? prisma.searchLog?.groupBy({
          by: ["year", "make", "model"],
          where: { shop, hasResults: false },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 10,
        })
      : [],
    detailed
      ? prisma.$queryRaw`
        SELECT DATE(createdAt) as date, COUNT(*) as count
        FROM SearchLog
        WHERE shop = ${shop} AND createdAt >= ${thirtyDaysAgo}
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      `
      : [],
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
    detailed,
    planLabel: limits.label,
  });
};

export default function Analytics() {
  const { stats, topVehicles, noResultVehicles, dailySearches, detailed, planLabel } = useLoaderData();

  const cards = [
    { label: "Total Searches", value: stats.totalSearches, color: "#2563eb", icon: "🔍", bgGradient: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)" },
    { label: "Matched Searches", value: stats.successfulSearches, color: "#008060", icon: "✓", bgGradient: "linear-gradient(135deg, #008060 0%, #005e46 100%)" },
    { label: "No-Result Searches", value: stats.noResultSearches, color: "#dc2626", icon: "⚠️", bgGradient: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)" },
    { label: "Search Success Rate", value: `${stats.successRate}%`, color: "#d97706", icon: "📈", bgGradient: "linear-gradient(135deg, #d97706 0%, #b45309 100%)" },
  ];

  const maxDailyCount = Math.max(...dailySearches.map((d) => d.count), 1);

  return (
    <div style={{ padding: "28px 24px", maxWidth: "1240px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#202223" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: "800", margin: "0 0 6px", color: "#0f172a", letterSpacing: "-0.5px" }}>Search Analytics & Intelligence</h1>
        <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
          Track customer vehicle searches, demand trends, and uncovered revenue opportunities.
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "18px", marginBottom: "32px" }}>
        {cards.map((c) => (
          <div key={c.label} style={kpiCardStyle}>
            <div style={{ height: "4px", width: "100%", position: "absolute", top: 0, left: 0, background: c.bgGradient }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "12px", fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {c.label}
              </span>
              <span style={{ fontSize: "18px" }}>{c.icon}</span>
            </div>
            <div style={{ fontSize: "36px", fontWeight: "800", color: "#0f172a", letterSpacing: "-1px" }}>
              {typeof c.value === "number" ? c.value.toLocaleString() : c.value}
            </div>
          </div>
        ))}
      </div>

      {!detailed && (
        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: "14px", padding: "24px", marginBottom: "32px", boxShadow: "0 4px 12px rgba(217, 119, 6, 0.08)" }}>
          <strong style={{ color: "#b45309", fontSize: "16px", display: "block", marginBottom: "6px" }}>⚡ Upgrade to Growth Professional for Deep Intelligence</strong>
          <p style={{ margin: "0 0 16px", fontSize: "14px", color: "#78350f" }}>
            Your current plan ({planLabel}) shows overall summary counts. Upgrade to unlock daily interactive trend charts, top vehicle rankings, and the No-Result Opportunity Gap report.
          </p>
          <Link to="/app/plans" style={upgradeBtnStyle}>Upgrade Plan →</Link>
        </div>
      )}

      {/* Daily Chart */}
      {detailed && dailySearches.length > 0 && (
        <div style={{ ...cardContainer, marginBottom: "32px" }}>
          <h3 style={cardTitleStyle}>📊 Daily Search Activity (Last 30 Days)</h3>
          <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 20px" }}>Storefront fitment widget query volume over time</p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "140px", overflowX: "auto", paddingTop: "20px", borderBottom: "1px solid #e2e8f0" }}>
            {dailySearches.map((d) => (
              <div key={d.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "1 0 24px" }}>
                <div
                  title={`${d.date}: ${d.count} searches`}
                  style={{
                    width: "100%",
                    maxWidth: "28px",
                    height: `${Math.max(Math.round((d.count / maxDailyCount) * 100), 6)}px`,
                    background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
                    borderRadius: "4px 4px 0 0",
                    transition: "all 0.2s",
                  }}
                />
                <div style={{ fontSize: "10px", color: "#64748b", marginTop: "8px", fontWeight: "600" }}>
                  {d.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detailed && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: "24px" }}>
          {/* Top Vehicles */}
          <div style={cardContainer}>
            <h3 style={cardTitleStyle}>🏆 Most Popular Vehicles Searched</h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>High-demand vehicle applications on your store</p>
            {topVehicles.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "14px" }}>No vehicle searches recorded yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                    <th style={thStyle}>Rank</th>
                    <th style={thStyle}>Vehicle Specification</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Search Count</th>
                  </tr>
                </thead>
                <tbody>
                  {topVehicles.map((v, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ ...tdStyle, width: "40px", fontWeight: "700", color: "#64748b" }}>#{i + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: "600", color: "#0f172a" }}>{v.year} {v.make} {v.model}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "4px 10px", borderRadius: "12px", fontWeight: "700", fontSize: "13px" }}>
                          {v._count.id} queries
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Opportunity Gap */}
          <div style={cardContainer}>
            <h3 style={{ ...cardTitleStyle, color: "#dc2626" }}>💡 Opportunity Gap (No-Result Queries)</h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>
              Vehicles searched by customers that returned 0 matching products.
            </p>
            {noResultVehicles.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "14px" }}>No unmapped vehicle queries found!</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                    <th style={thStyle}>Vehicle</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Searches</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Quick Action</th>
                  </tr>
                </thead>
                <tbody>
                  {noResultVehicles.map((v, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ ...tdStyle, fontWeight: "600", color: "#0f172a" }}>{v.year} {v.make} {v.model}</td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <span style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", padding: "3px 10px", borderRadius: "12px", fontWeight: "700", fontSize: "12px" }}>
                          {v._count.id} missed
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <Link
                          to={`/app/fitment/add?year=${v.year}&make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "#008060",
                            color: "#ffffff",
                            padding: "5px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: "700",
                            textDecoration: "none",
                          }}
                        >
                          + Add Fitment →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const kpiCardStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "24px",
  position: "relative",
  overflow: "hidden",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.03)",
};

const cardContainer = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const cardTitleStyle = {
  margin: "0 0 4px",
  fontSize: "17px",
  fontWeight: "800",
  color: "#0f172a",
};

const thStyle = {
  padding: "10px 8px",
  textAlign: "left",
  fontSize: "12px",
  color: "#64748b",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle = {
  padding: "14px 8px",
  fontSize: "14px",
};

const upgradeBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  background: "#d97706",
  color: "#ffffff",
  padding: "10px 18px",
  borderRadius: "8px",
  fontWeight: "700",
  fontSize: "14px",
  textDecoration: "none",
  boxShadow: "0 2px 6px rgba(217, 119, 6, 0.3)",
};
