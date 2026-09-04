/**
 * Resend Transactional Email Service
 * Handles sending admin email notifications when a merchant submits a support query.
 */

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendSupportEmailToAdmin({ merchantShop, senderName, senderEmail, subject, message }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || "CatalogHealth Alert <onboarding@resend.dev>";
  const adminEmail = process.env.ADMIN_EMAIL || "sandeepptpss@gmail.com";

  if (!apiKey) {
    console.error("[Resend Email Error] RESEND_API_KEY is not configured.");
    return { success: false, error: "RESEND_API_KEY is missing." };
  }

  const safeShop = escapeHtml(merchantShop);
  const safeName = escapeHtml(senderName);
  const safeEmail = escapeHtml(senderEmail);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message);

  const emailSubject = `[Merchant Support Query] ${subject || "New Query"} — ${merchantShop || senderName}`;
  const htmlBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #0f172a; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08); }
          .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px; color: #ffffff; }
          .header h1 { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
          .header p { margin: 0; color: #94a3b8; font-size: 13px; }
          .content { padding: 32px; }
          .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          .meta-table td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
          .label { font-weight: 700; color: #64748b; width: 140px; }
          .val { color: #0f172a; font-weight: 600; }
          .message-box { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #008060; padding: 20px; border-radius: 10px; margin-top: 16px; }
          .message-title { font-size: 13px; font-weight: 800; color: #008060; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
          .message-body { font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap; margin: 0; }
          .footer { background: #f1f5f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Support Query Received</h1>
            <p>A merchant has submitted a query via the PartMatch Support Center.</p>
          </div>
          <div class="content">
            <table class="meta-table">
              <tr>
                <td class="label">Merchant Store:</td>
                <td class="val"><strong style="color: #2563eb;">${safeShop || "Unknown Store"}</strong></td>
              </tr>
              <tr>
                <td class="label">Merchant Name:</td>
                <td class="val">${safeName}</td>
              </tr>
              <tr>
                <td class="label">Contact Email:</td>
                <td class="val"><a href="mailto:${safeEmail}" style="color: #2563eb; text-decoration: none;">${safeEmail}</a></td>
              </tr>
              <tr>
                <td class="label">Subject / Topic:</td>
                <td class="val">${safeSubject}</td>
              </tr>
              <tr>
                <td class="label">Submitted At:</td>
                <td class="val">${new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })} IST</td>
              </tr>
            </table>

            <div class="message-box">
              <div class="message-title">Query Message / Related Details</div>
              <p class="message-body">${safeMessage}</p>
            </div>
          </div>
          <div class="footer">
            Sent via Resend Transactional Email API • CatalogHealth Alert Notification System
          </div>
        </div>
      </body>
    </html>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [adminEmail],
        reply_to: senderEmail,
        subject: emailSubject,
        html: htmlBody,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[Resend Email API Error]", data);
      return { success: false, error: data.message || "Resend API call failed." };
    }

    console.log("[Resend Email Success] Email ID:", data.id);
    return { success: true, emailId: data.id };
  } catch (err) {
    console.error("[Resend Exception]", err);
    return { success: false, error: err.message || "Network error while sending email." };
  }
}
