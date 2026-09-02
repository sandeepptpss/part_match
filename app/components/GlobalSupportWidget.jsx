import { useState } from "react";

export default function GlobalSupportWidget({ shop = "", sessionEmail = "" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState(null); // { success: boolean, message: string }
  const [form, setForm] = useState({
    name: "",
    email: sessionEmail || "",
    subject: "",
    message: "",
  });

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.subject || !form.message) {
      setStatus({ success: false, message: "Please complete all fields before submitting." });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          subject: form.subject,
          message: form.message,
        }),
      });

      const data = await res.json();
      setIsSubmitting(false);

      if (data.success) {
        setStatus({
          success: true,
          message: data.message || "Query submitted successfully! We will get back to you shortly.",
        });
        setForm({
          name: "",
          email: sessionEmail || "",
          subject: "",
          message: "",
        });
      } else {
        setStatus({
          success: false,
          message: data.error || "Failed to submit query. Please try again.",
        });
      }
    } catch (err) {
      setIsSubmitting(false);
      setStatus({
        success: false,
        message: err.message || "Network error. Please try again.",
      });
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 999999, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      {/* Support Drawer / Modal Window */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "64px",
            right: "0",
            width: "380px",
            maxWidth: "calc(100vw - 32px)",
            background: "#ffffff",
            borderRadius: "16px",
            boxShadow: "0 20px 40px -10px rgba(15, 23, 42, 0.25), 0 0 15px rgba(0, 0, 0, 0.05)",
            border: "1px solid #cbd5e1",
            overflow: "hidden",
            animation: "supportSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Header Banner */}
          <div
            style={{
              background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
              color: "#ffffff",
              padding: "18px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ChatSupportIcon size={18} color="#34d399" />
                <strong style={{ fontSize: "16px", fontWeight: "800", letterSpacing: "-0.3px" }}>
                  Merchant Support Desk
                </strong>
                <span style={{ fontSize: "10px", background: "rgba(52, 211, 153, 0.2)", border: "1px solid rgba(52, 211, 153, 0.4)", color: "#34d399", padding: "2px 6px", borderRadius: "10px", fontWeight: "700" }}>
                  Online
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                Submit a query & get assistance from our team
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                color: "#ffffff",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                fontSize: "14px",
                fontWeight: "bold",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s ease",
              }}
              title="Close Support Window"
            >
              ✕
            </button>
          </div>

          {/* Form Content */}
          <div style={{ padding: "20px", maxHeight: "75vh", overflowY: "auto" }}>
            
            {/* Status Alert */}
            {status && (
              <div
                style={{
                  background: status.success ? "#ecfdf5" : "#fef2f2",
                  border: `1px solid ${status.success ? "#a7f3d0" : "#fecaca"}`,
                  color: status.success ? "#047857" : "#b91c1c",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  marginBottom: "16px",
                  fontSize: "13px",
                  lineHeight: "1.4",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <span>{status.success ? "✓" : "✕"}</span>
                <span>{status.message}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              
              {/* Merchant Name */}
              <div>
                <label style={labelStyle}>
                  Your Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  placeholder="e.g. John Store Owner"
                  style={inputStyle}
                />
              </div>

              {/* Contact Email */}
              <div>
                <label style={labelStyle}>
                  Contact Email <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="e.g. owner@yourstore.com"
                  style={inputStyle}
                />
              </div>

              {/* Query Subject */}
              <div>
                <label style={labelStyle}>
                  Query Subject / Topic <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.subject}
                  onChange={(e) => handleChange("subject", e.target.value)}
                  placeholder="e.g. Widget styling / CSV fitment mapping issue"
                  style={inputStyle}
                />
              </div>

              {/* Query Message */}
              <div>
                <label style={labelStyle}>
                  Query Details <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={form.message}
                  onChange={(e) => handleChange("message", e.target.value)}
                  placeholder="Describe your question or issue in detail..."
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  background: isSubmitting ? "#94a3b8" : "linear-gradient(135deg, #008060 0%, #005e46 100%)",
                  color: "#ffffff",
                  border: "none",
                  padding: "12px 18px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: "700",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 12px rgba(0, 128, 96, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  transition: "all 0.2s ease",
                  marginTop: "4px",
                }}
              >
                {isSubmitting ? "Sending Query..." : "Submit Support Query →"}
              </button>
            </form>

            <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid #f1f5f9", textAlign: "center", fontSize: "11px", color: "#94a3b8" }}>
              Shopify App Support • Average response under 2 hours
            </div>
          </div>
        </div>
      )}

      {/* Floating Trigger Launcher Button with Green Live Dot */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "linear-gradient(135deg, #008060 0%, #005e46 100%)",
          color: "#ffffff",
          border: "none",
          borderRadius: "30px",
          padding: "12px 22px",
          fontSize: "14px",
          fontWeight: "700",
          cursor: "pointer",
          boxShadow: "0 10px 25px -5px rgba(0, 128, 96, 0.4), 0 4px 12px rgba(0, 0, 0, 0.15)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: isOpen ? "scale(0.96)" : "scale(1)",
        }}
        title="Need Help? Contact Merchant Support"
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <ChatSupportIcon size={20} color="#ffffff" />
          <span
            style={{
              position: "absolute",
              top: "-3px",
              right: "-4px",
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "#34d399",
              border: "2px solid #008060",
              boxShadow: "0 0 6px #34d399",
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: "1.1" }}>
          <span>Support Available</span>
          <span style={{ fontSize: "10px", color: "#a7f3d0", fontWeight: "600" }}>Online Now</span>
        </div>
      </button>

      {/* Embedded keyframe animation */}
      <style>{`
        @keyframes supportSlideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function ChatSupportIcon({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="10" r="1" fill={color} />
      <circle cx="8" cy="10" r="1" fill={color} />
      <circle cx="16" cy="10" r="1" fill={color} />
    </svg>
  );
}

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: "700",
  color: "#0f172a",
  marginBottom: "4px",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "13px",
  boxSizing: "border-box",
  color: "#0f172a",
  outline: "none",
  background: "#ffffff",
  transition: "border-color 0.15s ease",
};
