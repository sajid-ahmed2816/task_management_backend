const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/index");
const multer = require("multer");
const cloudinary = require("../config/cloudinaryConfig");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  addAttachment,
  deleteAttachment,
  downloadAttachment,
  addSubTask,
  updateSubTask,
  deleteSubTask
} = require("../controller/task-controller");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "tasks/attachments",
    resource_type: "auto",
    allowedFormats: ["jpg", "jpeg", "png", "pdf", "docx", "xls", "xlsx", "csv"],
  },
});
const upload = multer({ storage });

router.use(authenticate);

router.get("/get", getTasks);
router.get("/:id", getTaskById);
router.get("/:id/attachments/:attachmentId/download", downloadAttachment);
router.post("/add", upload.array("files", 10), createTask);
router.post("/:id/subtasks", addSubTask);
router.patch("/update/:id", upload.array("files", 10), updateTask);
router.patch("/:id/subtasks/:subTaskId", updateSubTask);
router.delete("/delete/:id", deleteTask);
router.delete("/:id/subtasks/:subTaskId", deleteSubTask);
router.post("/:id/comments", addComment);
router.post("/:id/attachments", upload.array("files", 10), addAttachment);
router.delete("/:id/attachments/:attachmentId", deleteAttachment);


module.exports = router;