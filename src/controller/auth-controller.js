const jwt = require("jsonwebtoken");
const { sendResponse } = require("../helper/sendResponse");
const { sendOTPEmail, sendPasswordChangeOTPEmail } = require("../helper/sendEmail");
const User = require("../models/UserModel");
const { getCloudinaryAssetDetails, destroyCloudinaryAssets } = require("../helper/cloudinaryAssets");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const getSafeProfile = (user) => ({
  name: user.name,
  email: user.email,
  phone_number: user.phone_number,
  profile_picture: user.profile_picture || null,
});

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email phone_number profile_picture");
    if (!user) return res.status(404).send(sendResponse(false, null, "User not found"));
    return res.status(200).send(sendResponse(true, getSafeProfile(user), "Profile fetched successfully"));
  } catch (error) {
    console.error("Fetch profile failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const updateProfile = async (req, res) => {
  let profileSaved = false;
  try {
    const { name, phone_number: phoneNumber } = req.body || {};
    if (name === undefined && phoneNumber === undefined && !req.file) {
      return res.status(400).send(sendResponse(false, null, "Provide a name, phone number, or profile image to update"));
    }
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 100)) {
      return res.status(400).send(sendResponse(false, null, "Name must contain 1 to 100 characters"));
    }
    if (phoneNumber !== undefined && (typeof phoneNumber !== "string" || !phoneNumber.trim() || phoneNumber.trim().length > 30)) {
      return res.status(400).send(sendResponse(false, null, "Phone number must contain 1 to 30 characters"));
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).send(sendResponse(false, null, "User not found"));
    const previousPicture = user.profile_picture;
    if (name !== undefined) user.name = name.trim();
    if (phoneNumber !== undefined) user.phone_number = phoneNumber.trim();
    if (req.file) user.profile_picture = req.file.path;
    await user.save();
    profileSaved = true;

    if (req.file && previousPicture && previousPicture !== user.profile_picture) {
      const oldAsset = getCloudinaryAssetDetails({ url: previousPicture });
      if (oldAsset) {
        const { failures } = await destroyCloudinaryAssets([oldAsset]);
        if (failures.length) console.error("Old profile image cleanup failed:", failures);
      }
    }
    return res.status(200).send(sendResponse(true, getSafeProfile(user), "Profile updated successfully"));
  } catch (error) {
    console.error("Update profile failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  } finally {
    if (!profileSaved && req.file) {
      const { failures } = await destroyCloudinaryAssets([req.file]);
      if (failures.length) console.error("Profile image upload cleanup failed:", failures);
    }
  }
};

const requestPasswordChangeOTP = async (req, res) => {
  try {
    const now = new Date();
    const otp = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    const user = await User.findOneAndUpdate({
      _id: req.user.id,
      isVerified: true,
      $or: [
        { passwordChangeOtpSentAt: { $exists: false } },
        { passwordChangeOtpSentAt: { $lte: new Date(now.getTime() - 60 * 1000) } },
      ],
    }, {
      $set: {
        passwordChangeOtp: hashedOtp,
        passwordChangeOtpExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        passwordChangeOtpSentAt: now,
      },
    }, { new: true }).select("email");

    if (!user) {
      const currentUser = await User.findById(req.user.id).select("isVerified passwordChangeOtpSentAt");
      if (!currentUser) return res.status(404).send(sendResponse(false, null, "User not found"));
      if (!currentUser.isVerified) return res.status(403).send(sendResponse(false, null, "A verified email is required to change your password"));
      const retryAfter = Math.max(1, Math.ceil((60 * 1000 - (now.getTime() - new Date(currentUser.passwordChangeOtpSentAt).getTime())) / 1000));
      return res.status(429).send(sendResponse(false, { retryAfterSeconds: retryAfter }, "Please wait before requesting another code"));
    }

    try {
      await sendPasswordChangeOTPEmail(user.email, otp);
    } catch (emailError) {
      await User.updateOne({ _id: user._id, passwordChangeOtp: hashedOtp }, { $unset: { passwordChangeOtp: 1, passwordChangeOtpExpiresAt: 1 } });
      throw emailError;
    }
    return res.status(200).send(sendResponse(true, { email: user.email, expiresInSeconds: 600, resendAfterSeconds: 60 }, "Password change code sent"));
  } catch (error) {
    console.error("Password change OTP request failed:", error);
    return res.status(500).send(sendResponse(false, null, "Could not send password change code"));
  }
};

const verifyPasswordChangeOTP = async (req, res) => {
  const { otp, newPassword } = req.body || {};
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) return res.status(400).send(sendResponse(false, null, "Enter the 6-digit verification code"));
  if (typeof newPassword !== "string" || newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).send(sendResponse(false, null, "Password must be at least 8 characters and no more than 72 UTF-8 bytes"));
  }

  try {
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    const user = await User.findById(req.user.id).select("+passwordChangeOtp +passwordChangeOtpExpiresAt email isVerified");
    if (!user) return res.status(404).send(sendResponse(false, null, "User not found"));
    if (!user.isVerified) return res.status(403).send(sendResponse(false, null, "A verified email is required to change your password"));
    if (!user.passwordChangeOtp || !user.passwordChangeOtpExpiresAt || user.passwordChangeOtpExpiresAt <= new Date()) {
      return res.status(400).send(sendResponse(false, null, "Password change code is missing or expired"));
    }
    const storedHash = Buffer.from(user.passwordChangeOtp, "hex");
    const submittedHash = Buffer.from(hashedOtp, "hex");
    if (storedHash.length !== submittedHash.length || !crypto.timingSafeEqual(storedHash, submittedHash)) {
      return res.status(400).send(sendResponse(false, null, "Invalid password change code"));
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updatedUser = await User.findOneAndUpdate({
      _id: user._id,
      passwordChangeOtp: hashedOtp,
      passwordChangeOtpExpiresAt: { $gt: new Date() },
      isVerified: true,
    }, {
      $set: { password: passwordHash },
      $unset: { passwordChangeOtp: 1, passwordChangeOtpExpiresAt: 1, passwordChangeOtpSentAt: 1 },
    }, { new: true }).select("name email phone_number profile_picture");

    if (!updatedUser) return res.status(400).send(sendResponse(false, null, "Password change code is invalid or expired"));
    return res.status(200).send(sendResponse(true, getSafeProfile(updatedUser), "Password updated successfully"));
  } catch (error) {
    console.error("Password change verification failed:", error);
    return res.status(500).send(sendResponse(false, null, "Could not update password"));
  }
};

const JWT_SECRET = process.env.JWT_SECRET

const Login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send(sendResponse(false, null, "Email and password are required"));
    };

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).send(sendResponse(false, null, "User not found"));
    };

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).send(sendResponse(false, null, "Invalid credentials"));
    };

    // If user is verified, proceed with login
    if (user.isVerified) {
      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );
      const userWithoutPassword = user.toObject();
      delete userWithoutPassword.password;
      return res.status(200).send(sendResponse(true, { user: userWithoutPassword, token }, "Logged in successfully"));
    };

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    // Store the hash and expiry (10 minutes)
    user.otp = hashedOtp;
    user.otpExpiresAt = Date.now() + 10 * 60 * 1000;
    await user.save();

    // Send the plain numeric OTP via email
    await sendOTPEmail(email, otp);  // make sure sendOTPEmail sends the number, not the hash

    return res.status(200).send(sendResponse(true, { email: user.email, isVerified: false }, "Verification required – OTP sent to your email"));
  } catch (err) {
    console.error(err);
    res.status(500).send(sendResponse(false, null, err.message));
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

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiresAt = undefined;

    await user.save();

    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;

    res.status(200).send(sendResponse(true, { user: userWithoutPassword, token }, "Email verified successfully"));
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

module.exports = {
  Auth,
  Login,
  Signup,
  VerifyOTP,
  ResendOTP,
  getProfile,
  updateProfile,
  requestPasswordChangeOTP,
  verifyPasswordChangeOTP,
};
