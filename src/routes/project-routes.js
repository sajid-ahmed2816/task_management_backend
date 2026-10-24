const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/index");
const {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject
} = require("../controller/project-controller");

router.use(authenticate);

router.get("/:workspaceId/get", getProjects);
router.get("/:workspaceId/:id", getProjectById);
router.post("/:workspaceId/add", createProject);
router.patch("/:workspaceId/update/:id", updateProject);
router.delete("/:workspaceId/delete/:id", deleteProject);

module.exports = router;