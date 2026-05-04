const jwt = require("jsonwebtoken");
const { sendResponse } = require("../helper/sendResponse");
const { sendOTPEmail } = require("../helper/sendEmail");
const User = require("../models/UserModel");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET

const Login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send(sendResponse(false, null, "Email and password are required"));
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).send(sendResponse(false, null, "User not found"));
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).send(sendResponse(false, null, "Invalid credentials"));
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;

    res.status(200).send(sendResponse(true, { user: userWithoutPassword, token }, "Logged in successfully"));
  } catch (err) {
    console.error(err);
    res.status(500).send(sendResponse(false, null, err));
  }
};

const Signup = async (req, res) => {
  try {
    const { name, email, password, phone_number, profile_picture } = req.body;
    const obj = { name, email, password, phone_number };
    let reqArr = ["name", "email", "password", "phone_number"];
    let errArr = [];

    reqArr.forEach((item) => {
      if (!obj[item]) {
        errArr.push(item)
      };
    });

    if (errArr.length > 0) {
      return res.status(400).send(sendResponse(false, null, "Required all data"));
    };

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).send(sendResponse(false, null, "Email already registered"));
    };
    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone_number,
      profile_picture,
      otp: hashedOtp,
      otpExpiresAt: Date.now() + 10 * 60 * 1000, // 10 min
      isVerified: false
    });

    await user.save();
    await sendOTPEmail(email, otp);
    return res.status(200).send(sendResponse(true, user, "OTP send to your email"));
  } catch (error) {
    console.log(error);
    return res.status(500).send(sendResponse(false, null, error));
  }
};

const Auth = async (req, res) => {
  try {
    const { token } = req.body; // Firebase ID token from frontend

    if (!token) {
      return res.status(400).send(sendResponse(false, null, "Token is required"));
    }

    // Verify Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);
    const { name, email, picture } = decodedToken;

    let firstName = null;
    let lastName = null;
    if (name) {
      const parts = name.split(" ");
      firstName = parts[0];
      lastName = parts.slice(1).join(" ") || null;
    }

    if (!email) {
      return res.status(400).send(sendResponse(false, null, "Invalid token"));
    }

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        firstName,
        lastName,
        email,
        image: picture || null,
        role: "user"
      });
      await user.save();
    }
    // Generate JWT (valid for 7 days)
    const ourToken = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).send(sendResponse(true, { user, token: ourToken }, "User authenticated successfully"));
  } catch (err) {
    console.error(err);
    res.status(401).send(sendResponse(false, null, "Unauthorized"));
  }
};

const VerifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).send(sendResponse(false, null, "Email and OTP required"));
    };

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).send(sendResponse(false, null, "User not found"));
    };

    if (user.isVerified) {
      return res.status(400).send(sendResponse(false, null, "User already verified"));
    };

    if (user.otpExpiresAt < Date.now()) {
      return res.status(400).send(sendResponse(false, null, "OTP expired"));
    };

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    if (hashedOtp !== user.otp) {
      return res.status(400).send(sendResponse(false, null, "Invalid OTP"));
    };

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    res.status(200).send(sendResponse(true, user, "Email verified successfully"));
  } catch (error) {
    res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const ResendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).send(sendResponse(false, null, "Email is required"));
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).send(sendResponse(false, null, "User not found"));
    }

    if (user.isVerified) {
      return res.status(400).send(sendResponse(false, null, "User already verified"));
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.otp = hashedOtp;
    user.otpExpiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    await sendOTPEmail(email, otp);

    return res.status(200).send(sendResponse(true, null, "OTP resent to your email"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

module.exports = { Auth, Login, Signup, VerifyOTP, ResendOTP };