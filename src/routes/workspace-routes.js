
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/index");
const {
  createWorkspace,
  getWorkspaces,
  getWorkspaceDashboard,
  updateWorkspace,
  deleteWorkspace,
} = require("../controller/workspace-controller");

router.use(authMiddleware);

router.post("/add", createWorkspace);
router.get("/get", getWorkspaces);
router.get("/:workspaceId/dashboard", getWorkspaceDashboard);
router.patch("/update/:workspaceId", updateWorkspace);
router.delete("/delete/:workspaceId", deleteWorkspace);

module.exports = router;
