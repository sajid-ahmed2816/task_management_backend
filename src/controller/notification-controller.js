const mongoose = require("mongoose");
const Notification = require("../models/NotificationModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const { sendResponse } = require("../helper/sendResponse");
const { populateNotification } = require("../helper/notifications");

const getAccessibleWorkspaceIds = async (userId) => {
  const memberships = await WorkspaceMembership.find({ user: userId, status: "Active" }).select("workspace").lean();
  return memberships.map(({ workspace }) => workspace);
};

const emitUnreadCount = async (req, userId, workspaceIds) => {
  const unreadCount = workspaceIds.length
    ? await Notification.countDocuments({ recipient: userId, workspace: { $in: workspaceIds }, isRead: false })
    : 0;
  req.app.get("io")?.to(`user:${userId}`).emit("notification:unread-count", { unreadCount });
  return unreadCount;
};

const getUnreadCount = async (req, res) => {
  try {
    const workspaceIds = await getAccessibleWorkspaceIds(req.user.id);
    const unreadCount = workspaceIds.length
      ? await Notification.countDocuments({ recipient: req.user.id, workspace: { $in: workspaceIds }, isRead: false })
      : 0;
    return res.status(200).send(sendResponse(true, { unreadCount }, "Unread notification count fetched"));
  } catch (error) {
    console.error("Unread notification count failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const getNotifications = async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
  const filter = { recipient: req.user.id };
  try {
    const workspaceIds = await getAccessibleWorkspaceIds(req.user.id);
    if (!workspaceIds.length) return res.status(200).send(sendResponse(true, { notifications: [], unreadCount: 0, nextCursor: null }, "Notifications fetched"));
    filter.workspace = { $in: workspaceIds };
    let cursorDate = null;
    let cursorId = null;
    if (req.query.before) {
      try {
        const cursor = JSON.parse(Buffer.from(req.query.before, "base64url").toString("utf8"));
        cursorDate = new Date(cursor.createdAt);
        cursorId = cursor.id;
        if (Number.isNaN(cursorDate.getTime()) || !mongoose.isValidObjectId(cursorId)) throw new Error("Invalid cursor");
      } catch (error) {
        return res.status(400).send(sendResponse(false, null, "Invalid notification cursor"));
      }
      filter.$or = [
        { createdAt: { $lt: cursorDate } },
        { createdAt: cursorDate, _id: { $lt: new mongoose.Types.ObjectId(cursorId) } },
      ];
    }
    const items = await populateNotification(Notification.find(filter))
      .sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = items.length > limit;
    const notifications = items.slice(0, limit);
    const lastNotification = notifications[notifications.length - 1];
    const nextCursor = hasMore && lastNotification
      ? Buffer.from(JSON.stringify({ createdAt: lastNotification.createdAt.toISOString(), id: lastNotification._id.toString() })).toString("base64url")
      : null;
    const unreadCount = await Notification.countDocuments({ recipient: req.user.id, workspace: { $in: workspaceIds }, isRead: false });
    return res.status(200).send(sendResponse(true, { notifications, unreadCount, nextCursor }, "Notifications fetched"));
  } catch (error) {
    console.error("Fetch notifications failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const markNotificationRead = async (req, res) => {
  const { notificationId } = req.params;
  if (!mongoose.isValidObjectId(notificationId)) return res.status(400).send(sendResponse(false, null, "Invalid notification ID"));
  try {
    const workspaceIds = await getAccessibleWorkspaceIds(req.user.id);
    const notification = await Notification.findOneAndUpdate({
      _id: notificationId,
      recipient: req.user.id,
      workspace: { $in: workspaceIds },
    }, { $set: { isRead: true, readAt: new Date() } }, { new: true });
    if (!notification) return res.status(404).send(sendResponse(false, null, "Notification not found"));
    await emitUnreadCount(req, req.user.id, workspaceIds);
    const populated = await populateNotification(Notification.findById(notification._id)).lean();
    return res.status(200).send(sendResponse(true, populated, "Notification marked as read"));
  } catch (error) {
    console.error("Mark notification read failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    const workspaceIds = await getAccessibleWorkspaceIds(req.user.id);
    const result = workspaceIds.length
      ? await Notification.updateMany({ recipient: req.user.id, workspace: { $in: workspaceIds }, isRead: false }, { $set: { isRead: true, readAt: new Date() } })
      : { modifiedCount: 0 };
    await emitUnreadCount(req, req.user.id, workspaceIds);
    return res.status(200).send(sendResponse(true, { markedRead: result.modifiedCount }, "Notifications marked as read"));
  } catch (error) {
    console.error("Mark all notifications read failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

module.exports = { getUnreadCount, getNotifications, markNotificationRead, markAllNotificationsRead };
