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

module.exports = { sendOTPEmail }