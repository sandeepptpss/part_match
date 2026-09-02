const json = (data, init) => Response.json(data, init);
import { useState } from "react";
import { useLoaderData, Form, useNavigation, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DEFAULT_SETTINGS = {
  heading: "FIND YOUR PART",
  subheading: "SEARCH BY APPLICATION",
  yearLabel: "YEAR",
  makeLabel: "MAKE",
  modelLabel: "MODEL",
  searchButtonText: "SEARCH",
  clearButtonText: "CLEAR",
  primaryColor: "#0f172a",
  textColor: "#ffffff",
  backgroundColor: "#ffffff",
  borderRadius: 8,
  layout: "horizontal",
  showHeading: true,
  showSubheading: true,
};

const PRESET_PALETTES = [
  { name: "Executive Dark", btn: "#0f172a", text: "#ffffff", bg: "#ffffff" },
  { name: "Shopify Emerald", btn: "#008060", text: "#ffffff", bg: "#f0fdf4" },
  { name: "Automotive Sport", btn: "#dc2626", text: "#ffffff", bg: "#18181b" },
  { name: "Clean Slate", btn: "#334155", text: "#ffffff", bg: "#f8fafc" },
];

export const loader = async ({ request }) => {
  let shop = "";
  try {
    const { session } = await authenticate.admin(request);
    shop = session?.shop || "";
  } catch (err) {
    console.error("[app.widget loader auth error]", err);
  }

  if (!shop) {
    const firstRec = await prisma.fitmentRecord.findFirst({ select: { shop: true } });
    shop = firstRec?.shop || "quickstart-749ac396.myshopify.com";
  }

  let settings = null;
  try {
    settings = await prisma.widgetSettings?.upsert({
      where: { shop },
      create: { shop, ...DEFAULT_SETTINGS },
      update: {},
    });
  } catch (err) {
    console.error("[app.widget upsert error]", err);
    try {
      settings = await prisma.widgetSettings?.findUnique({ where: { shop } });
    } catch (e) {}
  }

  return json({
    shop,
    settings: settings || DEFAULT_SETTINGS,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const data = {
    heading: formData.get("heading")?.toString() || "FIND YOUR PART",
    subheading: formData.get("subheading")?.toString() || "SEARCH BY APPLICATION",
    yearLabel: formData.get("yearLabel")?.toString() || "YEAR",
    makeLabel: formData.get("makeLabel")?.toString() || "MAKE",
    modelLabel: formData.get("modelLabel")?.toString() || "MODEL",
    searchButtonText: formData.get("searchButtonText")?.toString() || "SEARCH",
    clearButtonText: formData.get("clearButtonText")?.toString() || "CLEAR",
    primaryColor: formData.get("primaryColor")?.toString() || "#0f172a",
    textColor: formData.get("textColor")?.toString() || "#ffffff",
    backgroundColor: formData.get("backgroundColor")?.toString() || "#ffffff",
    borderRadius: parseInt(formData.get("borderRadius") || "8", 10),
    layout: formData.get("layout")?.toString() || "horizontal",
    showHeading: formData.get("showHeading") === "on",
    showSubheading: formData.get("showSubheading") === "on",
  };

  try {
    await prisma.widgetSettings?.upsert({
      where: { shop },
      create: { shop, ...data },
      update: data,
    });
  } catch (err) {
    console.error("[app.widget action error]", err);
    return json({ error: "Failed to save widget settings" }, { status: 500 });
  }

  return json({ saved: true });
};

export default function WidgetSettings() {
  const { shop, settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";

  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const [formState, setFormState] = useState({
    heading: settings.heading || DEFAULT_SETTINGS.heading,
    subheading: settings.subheading || DEFAULT_SETTINGS.subheading,
    yearLabel: settings.yearLabel || DEFAULT_SETTINGS.yearLabel,
    makeLabel: settings.makeLabel || DEFAULT_SETTINGS.makeLabel,
    modelLabel: settings.modelLabel || DEFAULT_SETTINGS.modelLabel,
    searchButtonText: settings.searchButtonText || DEFAULT_SETTINGS.searchButtonText,
    clearButtonText: settings.clearButtonText || DEFAULT_SETTINGS.clearButtonText,
    primaryColor: settings.primaryColor || DEFAULT_SETTINGS.primaryColor,
    textColor: settings.textColor || DEFAULT_SETTINGS.textColor,
    backgroundColor: settings.backgroundColor || DEFAULT_SETTINGS.backgroundColor,
    borderRadius: typeof settings.borderRadius === "number" ? settings.borderRadius : DEFAULT_SETTINGS.borderRadius,
    layout: settings.layout || DEFAULT_SETTINGS.layout,
    showHeading: settings.showHeading ?? DEFAULT_SETTINGS.showHeading,
    showSubheading: settings.showSubheading ?? DEFAULT_SETTINGS.showSubheading,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormState((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const applyPreset = (preset) => {
    setFormState((prev) => ({
      ...prev,
      primaryColor: preset.btn,
      textColor: preset.text,
      backgroundColor: preset.bg,
    }));
  };

  const handleCopyCode = () => {
    const code = `<div id="partmatch-search-widget"></div>`;
    navigator.clipboard?.writeText(code);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2500);
  };

  const s = formState;
  const isMobileView = previewDevice === "mobile";

  return (
    <div style={{ padding: "28px 24px 60px", maxWidth: "1280px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#0f172a" }}>
      
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "800", margin: 0, color: "#0f172a", letterSpacing: "-0.5px" }}>
              Storefront Search Widget Studio
            </h1>
            <span style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", padding: "2px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "700" }}>
              Live Theme Editor
            </span>
          </div>
          <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
            Customize the look, colors, labels, and layout of the vehicle search widget on your storefront in real time.
          </p>
        </div>

        {/* Quick Launch Theme Customizer */}
        <div style={{ display: "flex", gap: "10px" }}>
          <a
            href={`https://${shop}/admin/themes/current/editor`}
            target="_blank"
            rel="noreferrer"
            style={outlineBtn}
          >
            <PaletteIcon size={14} color="#008060" />
            <span>Open Shopify Theme Editor</span>
            <ExternalIcon size={12} color="#008060" />
          </a>
        </div>
      </div>

      {actionData?.saved && (
        <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#047857", padding: "14px 18px", borderRadius: "12px", marginBottom: "24px", fontWeight: "700", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>✓</span> Search Widget customization settings saved successfully!
        </div>
      )}

      {actionData?.error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "14px 18px", borderRadius: "12px", marginBottom: "24px", fontWeight: "700", fontSize: "14px" }}>
          ⚠️ {actionData.error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 480px", gap: "28px", alignItems: "start" }}>
        
        {/* Left Column: Customization Form */}
        <Form method="post">
          
          {/* Quick Presets */}
          <div style={sectionCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={secHead}>
                <PaletteIcon size={18} color="#2563eb" />
                <span>1-Click Color Presets</span>
              </h3>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>Instant Themes</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
              {PRESET_PALETTES.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => applyPreset(p)}
                  style={{
                    padding: "10px 8px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.15s ease",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "center", gap: "4px", marginBottom: "6px" }}>
                    <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.btn, border: "1px solid #cbd5e1" }} />
                    <span style={{ width: "14px", height: "14px", borderRadius: "50%", background: p.bg, border: "1px solid #cbd5e1" }} />
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#334155", display: "block" }}>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Text & Labels */}
          <div style={sectionCard}>
            <h3 style={secHead}>
              <TextIcon size={18} color="#2563eb" />
              <span>Widget Text & Labels</span>
            </h3>
            {renderField("Heading Title", "heading", s.heading, handleChange)}
            {renderField("Subheading Text", "subheading", s.subheading, handleChange)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              {renderField("Year Label", "yearLabel", s.yearLabel, handleChange)}
              {renderField("Make Label", "makeLabel", s.makeLabel, handleChange)}
              {renderField("Model Label", "modelLabel", s.modelLabel, handleChange)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {renderField("Search Button Label", "searchButtonText", s.searchButtonText, handleChange)}
              {renderField("Clear Button Label", "clearButtonText", s.clearButtonText, handleChange)}
            </div>
          </div>

          {/* Styling & Layout */}
          <div style={sectionCard}>
            <h3 style={secHead}>
              <SlidersIcon size={18} color="#2563eb" />
              <span>Styling & Colors</span>
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={lbl}>Button Color</label>
                <input type="color" name="primaryColor" value={s.primaryColor} onChange={handleChange} style={colorInput} />
              </div>
              <div>
                <label style={lbl}>Button Text Color</label>
                <input type="color" name="textColor" value={s.textColor} onChange={handleChange} style={colorInput} />
              </div>
              <div>
                <label style={lbl}>Container Background</label>
                <input type="color" name="backgroundColor" value={s.backgroundColor} onChange={handleChange} style={colorInput} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={lbl}>Corner Radius ({s.borderRadius}px)</label>
                <input type="range" name="borderRadius" value={s.borderRadius} onChange={handleChange} min="0" max="24" style={{ width: "100%", accentColor: "#008060" }} />
              </div>
              <div>
                <label style={lbl}>Form Layout</label>
                <select name="layout" value={s.layout} onChange={handleChange} style={inp}>
                  <option value="horizontal">Horizontal Row</option>
                  <option value="stacked">Stacked Vertical</option>
                </select>
              </div>
            </div>
          </div>

          {/* Element Visibility */}
          <div style={sectionCard}>
            <h3 style={secHead}>
              <EyeIcon size={18} color="#2563eb" />
              <span>Element Visibility</span>
            </h3>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" name="showHeading" checked={s.showHeading} onChange={handleChange} style={{ width: "18px", height: "18px", accentColor: "#008060" }} />
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>Display Heading Title on Storefront</span>
            </label>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" name="showSubheading" checked={s.showSubheading} onChange={handleChange} style={{ width: "18px", height: "18px", accentColor: "#008060" }} />
              <span style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>Display Subheading Text on Storefront</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            style={primaryBtnStyle}
          >
            {saving ? "Saving Customizations…" : "Save Search Widget Customization"}
          </button>
        </Form>

        {/* Right Column: Sticky Device Live Preview */}
        <div style={{ position: "sticky", top: "24px" }}>
          
          {/* Device Switcher Controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "800", margin: 0, color: "#0f172a" }}>Storefront Live Preview</h3>
            <div style={{ display: "flex", gap: "4px", background: "#e2e8f0", padding: "3px", borderRadius: "8px" }}>
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                style={{
                  border: "none",
                  background: previewDevice === "desktop" ? "#ffffff" : "transparent",
                  color: previewDevice === "desktop" ? "#0f172a" : "#64748b",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <DesktopIcon size={14} color={previewDevice === "desktop" ? "#0f172a" : "#64748b"} />
                <span>Desktop</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                style={{
                  border: "none",
                  background: previewDevice === "mobile" ? "#ffffff" : "transparent",
                  color: previewDevice === "mobile" ? "#0f172a" : "#64748b",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <MobileIcon size={14} color={previewDevice === "mobile" ? "#0f172a" : "#64748b"} />
                <span>Mobile</span>
              </button>
            </div>
          </div>

          {/* Browser Frame Window */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "16px",
              overflow: "hidden",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.08)",
              maxWidth: isMobileView ? "340px" : "100%",
              margin: isMobileView ? "0 auto" : "0",
              transition: "all 0.3s ease",
            }}
          >
            {/* Fake Store Browser Header */}
            <div style={{ background: "#0f172a", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #334155" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ef4444" }} />
                <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f59e0b" }} />
                <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981" }} />
              </div>
              <span style={{ color: "#94a3b8", fontSize: "11px", fontWeight: "600", fontFamily: "monospace" }}>
                {shop || "your-store.com"}
              </span>
            </div>

            {/* Rendered Widget Inside Mockup */}
            <div style={{ padding: "24px 16px", background: "#f8fafc", minHeight: "220px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "100%", background: s.backgroundColor, borderRadius: `${s.borderRadius}px`, padding: "24px 18px", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" }}>
                {s.showHeading && (
                  <div style={{ textAlign: "center", fontWeight: "800", fontSize: "18px", color: "#0f172a", marginBottom: "4px", letterSpacing: "-0.3px" }}>
                    {s.heading}
                  </div>
                )}
                {s.showSubheading && (
                  <div style={{ textAlign: "center", color: "#64748b", fontSize: "13px", marginBottom: "18px" }}>
                    {s.subheading}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: isMobileView || s.layout === "stacked" ? "column" : "row", gap: "8px" }}>
                  {[s.yearLabel, s.makeLabel, s.modelLabel].map((lbl) => (
                    <select key={lbl} disabled style={{ flex: 1, padding: "9px 10px", borderRadius: `${s.borderRadius}px`, border: "1px solid #cbd5e1", fontSize: "13px", background: "#ffffff", color: "#64748b", fontWeight: "500" }}>
                      <option>{lbl}</option>
                    </select>
                  ))}
                  <button style={{ background: s.primaryColor, color: s.textColor, border: "none", padding: "9px 18px", borderRadius: `${s.borderRadius}px`, fontWeight: "700", fontSize: "13px", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.12)", flexShrink: 0 }}>
                    {s.searchButtonText}
                  </button>
                  <button style={{ background: "#ffffff", color: "#475569", border: "1px solid #cbd5e1", padding: "9px 12px", borderRadius: `${s.borderRadius}px`, fontWeight: "600", fontSize: "13px", cursor: "pointer", flexShrink: 0 }}>
                    {s.clearButtonText}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Integration Help Box */}
          <div style={{ marginTop: "20px", background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)", border: "1px solid #bae6fd", borderRadius: "14px", padding: "18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CodeIcon size={16} color="#0369a1" />
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#0369a1" }}>Liquid Embed Snippet</h4>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                style={{
                  background: copiedSnippet ? "#0284c7" : "#ffffff",
                  color: copiedSnippet ? "#ffffff" : "#0369a1",
                  border: "1px solid #7dd3fc",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                {copiedSnippet ? "✓ Copied!" : "Copy Snippet"}
              </button>
            </div>
            <p style={{ fontSize: "12px", color: "#0c4a6e", margin: 0, lineHeight: "1.5" }}>
              Insert <code>&lt;div id="partmatch-search-widget"&gt;&lt;/div&gt;</code> anywhere in your Liquid theme template.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Vector SVG Icon Helpers
function PaletteIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill={color} />
      <circle cx="17.5" cy="10.5" r=".5" fill={color} />
      <circle cx="8.5" cy="7.5" r=".5" fill={color} />
      <circle cx="6.5" cy="12.5" r=".5" fill={color} />
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 3.582 8 8 8 1.105 0 2-.895 2-2 0-.498-.182-.953-.485-1.306-.356-.414-.515-.968-.415-1.504.161-.861.914-1.49 1.79-1.49H16c3.314 0 6-2.686 6-6 0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

function TextIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function SlidersIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function EyeIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DesktopIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function MobileIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" strokeWidth="3" />
    </svg>
  );
}

function ExternalIcon({ size = 12, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function CodeIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function renderField(label, name, value, onChange) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <label style={lbl}>{label}</label>
      <input name={name} value={value} onChange={onChange} style={inp} />
    </div>
  );
}

// Styling Tokens
const sectionCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "22px",
  marginBottom: "20px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
};

const secHead = { fontSize: "15px", fontWeight: "800", color: "#0f172a", margin: "0 0 14px", display: "flex", alignItems: "center", gap: "8px" };
const lbl = { display: "block", fontSize: "12px", color: "#64748b", fontWeight: "700", marginBottom: "5px" };
const inp = { width: "100%", padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: "8px", fontSize: "13px", boxSizing: "border-box", outline: "none" };
const colorInput = { width: "100%", height: "40px", padding: "4px", border: "1px solid #cbd5e1", borderRadius: "8px", cursor: "pointer", background: "#ffffff" };
const checkboxLabelStyle = { display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "12px" };
const primaryBtnStyle = {
  background: "#008060",
  color: "#ffffff",
  border: "none",
  padding: "14px 28px",
  borderRadius: "10px",
  fontSize: "15px",
  fontWeight: "700",
  cursor: "pointer",
  boxShadow: "0 4px 12px rgba(0, 128, 96, 0.3)",
  width: "100%",
};

const outlineBtn = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  background: "#ffffff",
  color: "#008060",
  border: "1px solid #008060",
  padding: "10px 16px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: "700",
};
