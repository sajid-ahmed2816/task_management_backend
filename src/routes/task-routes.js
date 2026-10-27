const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/index");
const multer = require("multer");
const cloudinary = require("../config/cloudinaryConfig");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { destroyCloudinaryAssets } = require("../helper/cloudinaryAssets");
const { sendResponse } = require("../helper/sendResponse");
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
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "svg", "pdf", "doc", "docx", "docm", "odt", "rtf", "txt", "md", "xls", "xlsx", "xlsm", "csv", "ods", "ppt", "pptx", "pptm", "odp", "json", "xml", "zip", "7z", "rar"],
  },
});
storage._removeFile = (req, file, callback) => {
  destroyCloudinaryAssets([file]).then(({ failures }) => {
    if (failures.length > 0) return callback(failures[0].reason);
    return callback(null);
  }).catch(callback);
};

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 25 * 1024 * 1024 },
});
const uploadTaskFiles = (req, res, next) => upload.array("files", 10)(req, res, (error) => {
  if (!error) return next();
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  return res.status(status).send(sendResponse(false, null, error.message || "File upload failed"));
});

router.use(authenticate);

router.get("/:workspaceId/get", getTasks);
router.get("/:workspaceId/:id", getTaskById);
router.get("/:workspaceId/:id/attachments/:attachmentId/download", downloadAttachment);
router.post("/:workspaceId/add", uploadTaskFiles, createTask);
router.post("/:workspaceId/:id/subtasks", addSubTask);
router.patch("/:workspaceId/update/:id", uploadTaskFiles, updateTask);
router.patch("/:workspaceId/:id/subtasks/:subTaskId", updateSubTask);
router.delete("/:workspaceId/delete/:id", deleteTask);
router.delete("/:workspaceId/:id/subtasks/:subTaskId", deleteSubTask);
router.post("/:workspaceId/:id/comments", addComment);
router.post("/:workspaceId/:id/attachments", uploadTaskFiles, addAttachment);
router.delete("/:workspaceId/:id/attachments/:attachmentId", deleteAttachment);


module.exports = router;
