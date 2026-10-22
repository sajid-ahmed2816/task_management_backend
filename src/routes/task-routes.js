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

router.get("/:workspaceId/get", getTasks);
router.get("/:workspaceId/:id", getTaskById);
router.get("/:workspaceId/:id/attachments/:attachmentId/download", downloadAttachment);
router.post("/:workspaceId/add", upload.array("files", 10), createTask);
router.post("/:workspaceId/:id/subtasks", addSubTask);
router.patch("/:workspaceId/update/:id", upload.array("files", 10), updateTask);
router.patch("/:workspaceId/:id/subtasks/:subTaskId", updateSubTask);
router.delete("/:workspaceId/delete/:id", deleteTask);
router.delete("/:workspaceId/:id/subtasks/:subTaskId", deleteSubTask);
router.post("/:workspaceId/:id/comments", addComment);
router.post("/:workspaceId/:id/attachments", upload.array("files", 10), addAttachment);
router.delete("/:workspaceId/:id/attachments/:attachmentId", deleteAttachment);


module.exports = router;