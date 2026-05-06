const express = require("express");
const uploadFiles = require("../controller/file-controller");
const authenticate = require("../middleware");

const router = express.Router();

router.use(authenticate);

router.post("/uploads", uploadFiles);

module.exports = router;