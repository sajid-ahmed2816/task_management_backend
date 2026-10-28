const express = require("express");
const authenticate = require("../middleware/index");
const {
  getUnreadCount,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controller/notification-controller");

const router = express.Router();
router.use(authenticate);
router.get("/unread-count", getUnreadCount);
router.get("/", getNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:notificationId/read", markNotificationRead);

module.exports = router;
