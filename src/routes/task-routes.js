const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/index");
const multer = require("multer");
const cloudinary = require("../config/cloudinaryConfig");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { getTasks, createTask, updateTask, deleteTask, addComment, addAttachment, } = require("../controller/task-controller");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    allowedFormats: ["jpg", "jpeg", "png", "pdf", "docx"],
  },
});
const upload = multer({ storage });

router.use(authenticate);

router.get("/get", getTasks);
router.post("/add", upload.array("files", 10), createTask);
router.patch("/update/:id", upload.array("files", 10), updateTask);
router.delete("/delete/:id", deleteTask);
router.post("/:id/comments", addComment);
router.post("/:id/attachments", upload.array("files", 10), addAttachment);

module.exports = router;