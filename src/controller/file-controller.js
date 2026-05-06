const cloudinary = require("../config/cloudinaryConfig");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "uploads",
    allowedFormats: ["jpg", "png"],
  },
});

// Allow up to 10 files with the field name "files"
const upload = multer({ storage: storage });

const uploadFiles = (req, res) => {
  upload.array("files", 10)(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        message: "Image upload failed",
        error: err.message
      });
    }
    if (req.files && req.files.length > 0) {
      const urls = req.files.map((file) => file.path);
      res.json({
        message: "Images uploaded successfully",
        urls: urls,
        count: req.files.length,
        status: true,
      });
    } else {
      res.status(400).json({ message: "No images uploaded" });
    }
  });
};

module.exports = uploadFiles;