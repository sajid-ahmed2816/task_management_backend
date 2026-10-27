const transporter = require("../config/nodeMailerConfig");

const sendOTPEmail = async (email, otp) => {
  await transporter.sendMail({
    from: `"To Do App" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Email Verification OTP",
    html: `
      <h3>Email Verification</h3>
      <p>Your OTP is:</p>
      <h2>${otp}</h2>
      <p>This OTP will expire in 10 minutes.</p>
    `
  });
};

const sendPasswordChangeOTPEmail = async (email, otp) => {
  await transporter.sendMail({
    from: `"To Do App" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Password Change Verification Code",
    text: `Your password change verification code is ${otp}. It expires in 10 minutes. If you did not request this change, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px;color:#20343d">
        <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#168d86;text-transform:uppercase">Account security</div>
        <h2 style="margin:12px 0 8px;font-size:23px">Verify your password change</h2>
        <p style="margin:0;color:#62747b;line-height:1.6">Enter this code in your profile settings to set your new password.</p>
        <div style="margin:24px 0;padding:18px;text-align:center;background:#f2f8f7;border:1px solid #dcebe9;border-radius:12px;font-size:30px;font-weight:700;letter-spacing:8px;color:#126f6b">${otp}</div>
        <p style="margin:0;color:#62747b;line-height:1.6">This code expires in 10 minutes. If you did not request this change, ignore this email; your password will remain unchanged.</p>
      </div>
    `,
  });
};

module.exports = { sendOTPEmail, sendPasswordChangeOTPEmail }
