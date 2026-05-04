const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/index");
const { getTasks, createTask, updateTask, deleteTask, addComment, addAttachment, } = require("../controller/task-controller");

router.use(authenticate);

router.get("/get", getTasks);
router.post("/add", createTask);
router.patch("/update/:id", updateTask);
router.delete("/delete/:id", deleteTask);
router.post("/:id/comments", addComment);
router.post("/:id/attachments", addAttachment);

module.exports = router;