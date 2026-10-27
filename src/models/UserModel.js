const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  profile_picture: {
    type: String,
    default: null
  },
  email: {
    type: String,
    required: true,
  },
  phone_number: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true,
  },
  otp: {
    type: String
  },
  otpExpiresAt: {
    type: Date
  },
  passwordChangeOtp: {
    type: String,
    select: false,
  },
  passwordChangeOtpExpiresAt: {
    type: Date,
    select: false,
  },
  passwordChangeOtpSentAt: {
    type: Date,
    select: false,
  },
  isVerified: {
    type: Boolean,
    default: false
  }
});

const User = mongoose.model("User", userSchema);
module.exports = User;
