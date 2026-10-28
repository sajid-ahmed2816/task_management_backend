const Notification = require("../models/NotificationModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");

const populateNotification = (query) => query
  .populate("actor", "name profile_picture")
  .populate("workspace", "name")
  .populate("task", "title status dueDate")
  .populate("conversation", "_id")
  .populate({ path: "message", select: "text sender createdAt", populate: { path: "sender", select: "name profile_picture" } });

const createNotification = async ({
  io,
  recipient,
  actor,
  workspace,
  type,
  task = null,
  conversation = null,
  message = null,
  title,
  body = "",
  dedupeKey,
}) => {
  if (!recipient || !actor || recipient.toString() === actor.toString()) return null;

  try {
    const activeMembership = await WorkspaceMembership.exists({ workspace, user: recipient, status: "Active" });
    if (!activeMembership) return null;

    const result = await Notification.updateOne({ dedupeKey }, {
      $setOnInsert: { recipient, actor, workspace, type, task, conversation, message, title, body, dedupeKey },
    }, { upsert: true });
    if (!result.upsertedCount) return null;

    const notification = await populateNotification(Notification.findById(result.upsertedId)).lean();
    const room = `user:${recipient}`;
    io?.to(room).emit("notification:new", { notification });
    const workspaceMemberships = await WorkspaceMembership.find({ user: recipient, status: "Active" }).select("workspace").lean();
    const workspaceIds = workspaceMemberships.map((membership) => membership.workspace);
    const unreadCount = workspaceIds.length
      ? await Notification.countDocuments({ recipient, workspace: { $in: workspaceIds }, isRead: false })
      : 0;
    io?.to(room).emit("notification:unread-count", { unreadCount });
    return notification;
  } catch (error) {
    console.error("Persist notification failed:", error);
    return null;
  }
};

const notifyTaskAssignees = async ({ io, task, recipientIds, actor }) => {
  const uniqueRecipients = [...new Set((recipientIds || []).map((id) => id.toString()))]
    .filter((recipientId) => recipientId !== actor.toString());
  await Promise.all(uniqueRecipients.map((recipient) => createNotification({
    io,
    recipient,
    actor,
    workspace: task.workspace,
    type: "task_assigned",
    task: task._id,
    title: "Task assigned to you",
    body: task.title,
    dedupeKey: `task-assigned:${task._id}:${task.assignmentVersion || 1}:${recipient}`,
  })));
};

module.exports = { createNotification, notifyTaskAssignees, populateNotification };
