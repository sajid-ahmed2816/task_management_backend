const express = require("express");
const router = express.Router();
const multer = require("multer");
const cloudinary = require("../config/cloudinaryConfig");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const authenticate = require("../middleware/index");
const { destroyCloudinaryAssets } = require("../helper/cloudinaryAssets");
const { sendResponse } = require("../helper/sendResponse");
const {
  Auth,
  Login,
  Signup,
  VerifyOTP,
  ResendOTP,
  getProfile,
  updateProfile,
  requestPasswordChangeOTP,
  verifyPasswordChangeOTP,
} = require("../controller/auth-controller");

const profileImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "users/profile",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
  },
});
profileImageStorage._removeFile = (req, file, callback) => {
  destroyCloudinaryAssets([file]).then(({ failures }) => {
    if (failures.length) return callback(failures[0].reason);
    return callback(null);
  }).catch(callback);
};
const uploadProfileImage = multer({
  storage: profileImageStorage,
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
}).single("profile_picture");
const handleProfileImageUpload = (req, res, next) => uploadProfileImage(req, res, (error) => {
  if (!error) return next();
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  return res.status(status).send(sendResponse(false, null, error.message || "Profile image upload failed"));
});

router.post("/login/google", Auth);
router.post("/signup", Signup);
router.post("/login", Login);
router.post("/verify-otp", VerifyOTP);
router.post("/resend-otp", ResendOTP);

router.get("/profile", authenticate, getProfile);
router.patch("/profile", authenticate, handleProfileImageUpload, updateProfile);
router.post("/profile/password/request-otp", authenticate, requestPasswordChangeOTP);
router.post("/profile/password/verify-otp", authenticate, verifyPasswordChangeOTP);

module.exports = router;
