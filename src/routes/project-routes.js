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

router.get("/get", getProjects);
router.get("/:id", getProjectById);
router.post("/add", createProject);
router.patch("/update/:id", updateProject);
router.delete("/delete/:id", deleteProject);

module.exports = router;