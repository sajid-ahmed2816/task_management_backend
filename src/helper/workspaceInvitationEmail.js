const transporter = require("../config/nodeMailerConfig");

const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

const sendWorkspaceInvitationEmail = async ({ email, workspaceName, inviterName, token }) => {
  const appUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
  const inviteUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
  const safeWorkspace = escapeHtml(workspaceName);
  const safeInviter = escapeHtml(inviterName || "A teammate");

  await transporter.sendMail({
    from: `"Todo Workspace" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${inviterName || "A teammate"} invited you to ${workspaceName}`,
    text: `${inviterName || "A teammate"} invited you to join ${workspaceName}. Sign in or create an account with this email, then accept your invitation: ${inviteUrl}. This link expires in 7 days.`,
    html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Workspace invitation</title></head>
  <body style="margin:0;padding:0;background:#f3f7f7;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#20333b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">You have been invited to collaborate in ${safeWorkspace}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f7;padding:36px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border:1px solid #e4eceb;border-radius:20px;overflow:hidden;">
          <tr><td style="padding:28px 36px;background:#123f46;color:#ffffff;">
            <div style="font-size:13px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#a9d8d2;">TODO WORKSPACE</div>
            <div style="font-size:26px;line-height:1.25;font-weight:750;margin-top:22px;">A seat at the table<br>is waiting for you.</div>
          </td></tr>
          <tr><td style="padding:34px 36px 12px;">
            <div style="width:54px;height:54px;line-height:54px;text-align:center;border-radius:16px;background:#e8f5f2;color:#168d86;font-size:25px;font-weight:700;">${safeWorkspace.slice(0, 1).toUpperCase()}</div>
            <p style="font-size:16px;line-height:1.7;margin:24px 0 8px;"><strong>${safeInviter}</strong> invited you to join</p>
            <h1 style="font-size:25px;line-height:1.3;margin:0;color:#18343c;">${safeWorkspace}</h1>
            <p style="font-size:15px;line-height:1.7;color:#6e8087;margin:14px 0 26px;">Work together on tasks and projects, and keep everything your team needs in one place.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:#168d86;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 23px;border-radius:11px;">Accept invitation&nbsp; &rarr;</a>
            <p style="font-size:13px;line-height:1.65;color:#849198;margin:24px 0 8px;">Sign in or create an account using <strong>${escapeHtml(email)}</strong> before accepting. This invitation link expires in 7 days and can only be used once.</p>
            <p style="font-size:12px;line-height:1.6;color:#9aa6aa;margin:18px 0 8px;">Button not working? Copy this link into your browser:</p>
            <p style="font-size:12px;line-height:1.6;word-break:break-all;margin:0 0 20px;"><a href="${inviteUrl}" style="color:#168d86;">${inviteUrl}</a></p>
          </td></tr>
          <tr><td style="padding:18px 36px 24px;border-top:1px solid #edf1f1;color:#9aa6aa;font-size:12px;line-height:1.6;">If you weren't expecting this invitation, you can ignore this email.<br>&copy; ${new Date().getFullYear()} Todo Workspace</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  });
};

module.exports = { sendWorkspaceInvitationEmail };
