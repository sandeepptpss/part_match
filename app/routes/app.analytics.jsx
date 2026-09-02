const json = (data, init) => Response.json(data, init);
import { useLoaderData, Link, useSearchParams } from "react-router";
import PropTypes from "prop-types";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getShopPlan, planLimits } from "../plans.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d"; // 7d | 30d | all

  const now = new Date();
  let startDate = null;
  if (range === "7d") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "30d") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const dateWhere = startDate ? { createdAt: { gte: startDate } } : {};
  const shopWhere = { shop, ...dateWhere };

  const { plan } = await getShopPlan(shop);
  const limits = planLimits(plan);

  try {
    const [
      totalSearches,
      successfulSearches,
      noResultSearches,
      topVehiclesRaw,
      noResultVehiclesRaw,
      recentLogsRaw,
      allLogsForChart,
    ] = await Promise.all([
      prisma.searchLog?.count({ where: shopWhere }) ?? 0,
      prisma.searchLog?.count({ where: { ...shopWhere, hasResults: true } }) ?? 0,
      prisma.searchLog?.count({ where: { ...shopWhere, hasResults: false } }) ?? 0,
      prisma.searchLog?.groupBy({
        by: ["year", "make", "model"],
        where: shopWhere,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }) ?? [],
      prisma.searchLog?.groupBy({
        by: ["year", "make", "model"],
        where: { ...shopWhere, hasResults: false },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }) ?? [],
      prisma.searchLog?.findMany({
        where: shopWhere,
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          year: true,
          make: true,
          model: true,
          hasResults: true,
          resultCount: true,
          createdAt: true,
        },
      }) ?? [],
      prisma.searchLog?.findMany({
        where: shopWhere,
        select: { createdAt: true, hasResults: true },
        orderBy: { createdAt: "asc" },
      }) ?? [],
    ]);

    // Group daily counts in JS
    const dailyMap = {};
    allLogsForChart.forEach((log) => {
      const dateObj = new Date(log.createdAt);
      const dateStr = dateObj.toISOString().slice(0, 10);
      const formattedLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr, label: formattedLabel, total: 0, matched: 0, missed: 0 };
      }
      dailyMap[dateStr].total += 1;
      if (log.hasResults) {
        dailyMap[dateStr].matched += 1;
      } else {
        dailyMap[dateStr].missed += 1;
      }
    });

    const dailySearches = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    const successRate = totalSearches > 0 ? Math.round((successfulSearches / totalSearches) * 100) : 0;
    const estimatedReturnsPrevented = Math.round(successfulSearches * 0.15); // ~15% wrong-part returns avoided
    const estimatedSavedReturnCost = estimatedReturnsPrevented * 35; // ~$35 average return shipping & restock fee

    return json({
      stats: {
        totalSearches,
        successfulSearches,
        noResultSearches,
        successRate,
        estimatedReturnsPrevented,
        estimatedSavedReturnCost,
      },
      topVehicles: topVehiclesRaw,
      noResultVehicles: noResultVehiclesRaw,
      recentLogs: recentLogsRaw.map((l) => ({
        ...l,
        createdAt: new Date(l.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }),
      })),
      dailySearches,
      range,
      planLabel: limits.label,
    });
  } catch (err) {
    console.error("[analytics loader error]", err);
    return json({
      stats: { totalSearches: 0, successfulSearches: 0, noResultSearches: 0, successRate: 0, estimatedReturnsPrevented: 0, estimatedSavedReturnCost: 0 },
      topVehicles: [],
      noResultVehicles: [],
      recentLogs: [],
      dailySearches: [],
      range,
      planLabel: limits.label,
    });
  }
};

export default function Analytics() {
  const { stats, topVehicles, noResultVehicles, recentLogs, dailySearches, range } = useLoaderData();
  const [, setSearchParams] = useSearchParams();

  const handleRangeChange = (newRange) => {
    setSearchParams({ range: newRange });
  };

  const cards = [
    { label: "Total Customer Searches", value: stats.totalSearches, color: "#2563eb", icon: <SearchIcon color="#2563eb" />, bg: "#eff6ff", trend: "100% Verified" },
    { label: "Fitment Conversion", value: `${stats.successRate}%`, color: "#7c3aed", icon: <TrendingUpIcon color="#7c3aed" />, bg: "#f3e8ff", trend: "High Match Rate" },
    { label: "Matched Vehicle Fits", value: stats.successfulSearches, color: "#059669", icon: <CheckCircleIcon color="#059669" />, bg: "#ecfdf5", trend: "Live Searches" },
    { label: "Prevented Returns", value: `${stats.estimatedReturnsPrevented} orders`, color: "#0284c7", icon: <ShieldCheckIcon color="#0284c7" />, bg: "#f0f9ff", trend: "Est. Wrong Part Saved" },
    { label: "Est. Return Savings", value: `$${stats.estimatedSavedReturnCost.toLocaleString()}`, color: "#d97706", icon: <DollarIcon color="#d97706" />, bg: "#fffbe6", trend: "@ $35/return cost" },
  ];

  const maxDailyCount = Math.max(...dailySearches.map((d) => d.total), 5);
  // Y-axis grid scale steps
  const gridSteps = [maxDailyCount, Math.round(maxDailyCount * 0.75), Math.round(maxDailyCount * 0.5), Math.round(maxDailyCount * 0.25), 0];

  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1280px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      
      {/* Header & Date Filter Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>
              Search Analytics & Vehicle Intelligence
            </h1>
            <span style={{ background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", border: "1px solid #a7f3d0", color: "#047857", padding: "3px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "700", display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }} />
              Live Storefront Metrics
            </span>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Track customer vehicle application queries, fitment conversions, and uncovered inventory opportunities.
          </p>
        </div>

        {/* Date Filter Tabs */}
        <div style={{ display: "flex", gap: "4px", background: "#f1f5f9", borderRadius: "10px", padding: "4px", border: "1px solid #e2e8f0" }}>
          <button
            type="button"
            onClick={() => handleRangeChange("7d")}
            style={filterTabStyle(range === "7d")}
          >
            Last 7 Days
          </button>
          <button
            type="button"
            onClick={() => handleRangeChange("30d")}
            style={filterTabStyle(range === "30d")}
          >
            Last 30 Days
          </button>
          <button
            type="button"
            onClick={() => handleRangeChange("all")}
            style={filterTabStyle(range === "all")}
          >
            All Time
          </button>
        </div>
      </div>

      {/* Executive KPI Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "16px", marginBottom: "28px" }}>
        {cards.map((c) => (
          <div key={c.label} style={kpiCardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {c.label}
              </span>
              <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: c.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {c.icon}
              </div>
            </div>
            <div style={{ fontSize: "28px", fontWeight: "800", color: "#0f172a", letterSpacing: "-0.8px", marginBottom: "4px" }}>
              {typeof c.value === "number" ? c.value.toLocaleString() : c.value}
            </div>
            <div style={{ fontSize: "11px", fontWeight: "600", color: "#64748b" }}>
              {c.trend}
            </div>
          </div>
        ))}
      </div>

      {/* Sleek Daily Search Activity Chart */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "24px", marginBottom: "28px", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: "800", margin: "0 0 4px", color: "#0f172a" }}>Daily Search Query Volume</h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Customer vehicle searches logged over the selected period ({range.toUpperCase()})</p>
          </div>
          <div style={{ display: "flex", gap: "20px", alignItems: "center", background: "#f8fafc", padding: "6px 14px", borderRadius: "20px", border: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#334155", fontWeight: "600" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "4px", background: "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)", boxShadow: "0 2px 4px rgba(37,99,235,0.3)" }} />
              <span>Matched Searches</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#334155", fontWeight: "600" }}>
              <span style={{ width: "12px", height: "12px", borderRadius: "4px", background: "linear-gradient(180deg, #f87171 0%, #dc2626 100%)", boxShadow: "0 2px 4px rgba(220,38,38,0.3)" }} />
              <span>No-Result Queries</span>
            </div>
          </div>
        </div>

        {dailySearches.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center", color: "#64748b", background: "#f8fafc", borderRadius: "12px", border: "1px dashed #cbd5e1" }}>
            <SearchIcon size={36} color="#94a3b8" />
            <p style={{ margin: "12px 0 4px", fontSize: "14px", fontWeight: "700", color: "#334155" }}>No storefront vehicle searches logged yet</p>
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>Searches performed by store visitors using the Year/Make/Model widget will appear here automatically.</p>
          </div>
        ) : (
          <div style={{ position: "relative", paddingTop: "10px" }}>
            {/* Background Grid Lines & Y-Axis Scale */}
            <div style={{ position: "absolute", top: "10px", left: "0", right: "0", bottom: "34px", display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none", zIndex: 0 }}>
              {gridSteps.map((step, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", width: "100%" }}>
                  <span style={{ width: "32px", fontSize: "10px", color: "#94a3b8", fontWeight: "700", textAlign: "right", paddingRight: "10px" }}>
                    {step}
                  </span>
                  <div style={{ flex: 1, borderTop: "1px dashed #e2e8f0" }} />
                </div>
              ))}
            </div>

            {/* Bars Area */}
            <div style={{ position: "relative", zIndex: 1, marginLeft: "36px", display: "flex", alignItems: "flex-end", gap: "16px", height: "180px", paddingBottom: "34px", overflowX: "auto" }}>
              {dailySearches.map((d) => {
                const totalPct = Math.min(100, Math.max(8, Math.round((d.total / maxDailyCount) * 100)));
                const matchedPct = d.total > 0 ? (d.matched / d.total) * 100 : 100;
                const missedPct = d.total > 0 ? (d.missed / d.total) * 100 : 0;

                return (
                  <div key={d.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "1 0 36px", maxWidth: "48px", height: "100%", justifyContent: "flex-end" }}>
                    {/* Top Numeric Badge */}
                    <div style={{ fontSize: "11px", fontWeight: "800", color: "#3b82f6", marginBottom: "6px" }}>
                      {d.total}
                    </div>

                    {/* Staked Bar Container */}
                    <div
                      title={`${d.label} (${d.date}): ${d.total} total searches (${d.matched} matched, ${d.missed} 0-result)`}
                      style={{
                        width: "100%",
                        maxWidth: "28px",
                        height: `${totalPct}%`,
                        display: "flex",
                        flexDirection: "column",
                        borderRadius: "8px 8px 2px 2px",
                        overflow: "hidden",
                        boxShadow: "0 3px 8px rgba(37,99,235,0.15)",
                        transition: "transform 0.2s ease",
                        cursor: "pointer",
                      }}
                    >
                      {/* Missed Portion (Top) */}
                      {d.missed > 0 && (
                        <div
                          style={{
                            width: "100%",
                            height: `${missedPct}%`,
                            background: "linear-gradient(180deg, #f87171 0%, #dc2626 100%)",
                          }}
                        />
                      )}
                      {/* Matched Portion (Bottom) */}
                      {d.matched > 0 && (
                        <div
                          style={{
                            width: "100%",
                            height: `${matchedPct}%`,
                            background: "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
                          }}
                        />
                      )}
                    </div>

                    {/* Date Label */}
                    <span style={{ position: "absolute", bottom: "4px", fontSize: "11px", color: "#64748b", fontWeight: "700", whiteSpace: "nowrap" }}>
                      {d.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Grid: Top Searched Vehicles & Opportunity Gap */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: "24px", marginBottom: "28px" }}>
        
        {/* Top Searched Vehicles */}
        <div style={cardContainer}>
          <h3 style={cardTitleStyle}>Most Popular Vehicles Searched</h3>
          <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>Highest volume vehicle applications queried by customers</p>
          {topVehicles.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "14px", padding: "20px 0" }}>No vehicle searches recorded yet.</p>
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
                    <td style={{ ...tdStyle, width: "40px", fontWeight: "800", color: i === 0 ? "#d97706" : i === 1 ? "#64748b" : i === 2 ? "#b45309" : "#94a3b8" }}>
                      #{i + 1}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: "700", color: "#0f172a" }}>
                      {v.year} {v.make} {v.model}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", padding: "3px 10px", borderRadius: "12px", fontWeight: "700", fontSize: "12px" }}>
                        {v._count.id} queries
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Opportunity Gap (No-Result Queries) */}
        <div style={cardContainer}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <h3 style={{ ...cardTitleStyle, color: "#dc2626" }}>Opportunity Gap (No-Result Queries)</h3>
            <span style={{ fontSize: "11px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", padding: "2px 8px", borderRadius: "10px", fontWeight: "700" }}>
              High Demand
            </span>
          </div>
          <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>
            Vehicles searched by customers that returned 0 matching products.
          </p>
          {noResultVehicles.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#047857" }}>
              <CheckCircleIcon size={24} color="#047857" />
              <p style={{ margin: "8px 0 0", fontSize: "14px", fontWeight: "600" }}>All customer vehicle searches matched live products!</p>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                  <th style={thStyle}>Vehicle</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Missed</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Quick Action</th>
                </tr>
              </thead>
              <tbody>
                {noResultVehicles.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                    <td style={{ ...tdStyle, fontWeight: "700", color: "#0f172a" }}>
                      {v.year} {v.make} {v.model}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", padding: "3px 10px", borderRadius: "12px", fontWeight: "700", fontSize: "12px" }}>
                        {v._count.id} missed
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <Link
                        to={`/app/fitment/add?year=${v.year}&make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}`}
                        style={addFitmentBtn}
                      >
                        <PlusIcon size={12} color="#ffffff" />
                        <span>Map Fitment</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Live Recent Search Activity Log Table */}
      <div style={cardContainer}>
        <h3 style={cardTitleStyle}>Realtime Search Stream</h3>
        <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>Latest customer vehicle search interactions on your store</p>
        {recentLogs.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: "14px", padding: "16px 0" }}>No customer search logs recorded yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                <th style={thStyle}>Timestamp</th>
                <th style={thStyle}>Vehicle Application</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Products Found</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                  <td style={{ ...tdStyle, color: "#64748b", fontSize: "13px" }}>{log.createdAt}</td>
                  <td style={{ ...tdStyle, fontWeight: "700", color: "#0f172a" }}>
                    {log.year} {log.make} {log.model}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center", fontWeight: "600", color: "#334155" }}>
                    {log.resultCount} items
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {log.hasResults ? (
                      <span style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "2px 8px", borderRadius: "10px", fontSize: "12px", fontWeight: "700" }}>
                        ✓ Matched
                      </span>
                    ) : (
                      <span style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "2px 8px", borderRadius: "10px", fontSize: "12px", fontWeight: "700" }}>
                        ✕ 0 Results
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Vector SVG Helpers
function SearchIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

SearchIcon.propTypes = { size: PropTypes.number, color: PropTypes.string };

function TrendingUpIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

TrendingUpIcon.propTypes = { size: PropTypes.number, color: PropTypes.string };

function CheckCircleIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

CheckCircleIcon.propTypes = { size: PropTypes.number, color: PropTypes.string };

function ShieldCheckIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

ShieldCheckIcon.propTypes = { size: PropTypes.number, color: PropTypes.string };

function DollarIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

DollarIcon.propTypes = { size: PropTypes.number, color: PropTypes.string };

function PlusIcon({ size = 12, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

PlusIcon.propTypes = { size: PropTypes.number, color: PropTypes.string };

// Styling Tokens
const kpiCardStyle = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "20px",
  position: "relative",
  overflow: "hidden",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.03)",
};

const cardContainer = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const cardTitleStyle = {
  margin: "0 0 2px",
  fontSize: "16px",
  fontWeight: "800",
  color: "#0f172a",
};

const thStyle = {
  padding: "10px 8px",
  textAlign: "left",
  fontSize: "11px",
  color: "#64748b",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle = {
  padding: "12px 8px",
  fontSize: "13px",
};

const filterTabStyle = (active) => ({
  border: "none",
  background: active ? "#ffffff" : "transparent",
  color: active ? "#008060" : "#64748b",
  fontWeight: active ? "700" : "600",
  padding: "6px 14px",
  borderRadius: "7px",
  fontSize: "12px",
  cursor: "pointer",
  boxShadow: active ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
  transition: "all 0.15s ease",
});

const addFitmentBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  background: "#008060",
  color: "#ffffff",
  padding: "5px 12px",
  borderRadius: "6px",
  fontSize: "12px",
  fontWeight: "700",
  textDecoration: "none",
};

