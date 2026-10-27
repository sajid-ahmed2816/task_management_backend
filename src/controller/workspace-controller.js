
const mongoose = require("mongoose");
const Workspace = require("../models/WorkspaceModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const WorkspaceInvitation = require("../models/WorkspaceInvitationModel");
const Project = require("../models/ProjectModel");
const Task = require("../models/TaskModel");
const ChatConversation = require("../models/ChatConversationModel");
const ChatMessage = require("../models/ChatMessageModel");
const { sendResponse } = require("../helper/sendResponse");
const { destroyCloudinaryAssets } = require("../helper/cloudinaryAssets");

const isValidId = (id) => mongoose.isValidObjectId(id);

const getActiveMembership = (workspace, user) => {
  return WorkspaceMembership.findOne({
    workspace,
    user,
    status: "Active",
  });
};

const createWorkspace = async (req, res) => {
  const user = req.user?.id;
  const { name, description = "" } = req.body;

  if (!user) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).send(sendResponse(false, null, "Valid name is required"));
  };

  if (typeof description !== "string") {
    return res.status(400).send(sendResponse(false, null, "Description must be a string"));
  };

  let session;

  try {
    session = await mongoose.startSession();

    let workspace;

    await session.withTransaction(async () => {
      workspace = new Workspace({
        name: name.trim(),
        description: description.trim(),
        owner: user,
      });

      await workspace.save({ session });

      const workspaceMembership = new WorkspaceMembership({
        workspace: workspace._id,
        user,
        role: "Owner",
        status: "Active",
      });

      await workspaceMembership.save({ session });
    });

    return res.status(201).send(
      sendResponse(true, workspace, "Workspace created successfully")
    );
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  } finally {
    if (session) await session.endSession();
  }
};

const getWorkspaces = async (req, res) => {
  const user = req.user?.id;

  if (!user) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  try {
    const memberships = await WorkspaceMembership.find({
      user,
      status: "Active",
    }).populate({
      path: "workspace",
      select: "name description background owner createdAt updatedAt",
    }).sort({ createdAt: -1 });

    const workspaces = memberships.filter((membership) => membership.workspace).map((membership) => ({
      ...membership.workspace.toObject(),
      role: membership.role,
      membershipId: membership._id,
    }));

    return res.status(200).send(
      sendResponse(true, { workspaces }, "Workspaces fetched successfully")
    );
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const getWorkspaceDashboard = async (req, res) => {
  const userId = req.user?.id;
  const { workspaceId } = req.params;
  if (!userId) return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  if (!isValidId(workspaceId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));

  try {
    const membership = await WorkspaceMembership.exists({ workspace: workspaceId, user: userId, status: "Active" });
    if (!membership) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));

    const now = new Date();
    const pakistanOffsetMs = 5 * 60 * 60 * 1000;
    const pakistanDate = new Date(now.getTime() + pakistanOffsetMs);
    pakistanDate.setUTCHours(0, 0, 0, 0);
    const startOfToday = new Date(pakistanDate.getTime() - pakistanOffsetMs);
    const upcomingUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const projectFilter = { workspace: workspaceId, isDeleted: false };
    const taskFilter = { workspace: workspaceId, isDeleted: false };
    const taskPreviewPopulate = [
      { path: "project", select: "name" },
      { path: "assignees", select: "name profile_picture" },
      { path: "completedBy", select: "name profile_picture" },
    ];

    const [projectStatusCounts, taskStatusCounts, overdue, upcoming, assignedToMe,
      upcomingTasks, myTasks, recentTasks, activeMembers, recentConversations] = await Promise.all([
      Project.aggregate([
        { $match: projectFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Task.aggregate([
        { $match: taskFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Task.countDocuments({ ...taskFilter, dueDate: { $lt: startOfToday }, status: { $ne: "done" } }),
      Task.countDocuments({ ...taskFilter, dueDate: { $gte: startOfToday, $lte: upcomingUntil }, status: { $ne: "done" } }),
      Task.countDocuments({ ...taskFilter, assignees: userId, status: { $ne: "done" } }),
      Task.find({ ...taskFilter, dueDate: { $gte: startOfToday, $lte: upcomingUntil }, status: { $ne: "done" } })
        .select("title status priority dueDate updatedAt completedBy project assignees")
        .populate(taskPreviewPopulate).sort({ dueDate: 1, _id: 1 }).limit(5).lean(),
      Task.find({ ...taskFilter, assignees: userId, status: { $ne: "done" } })
        .select("title status priority dueDate updatedAt completedBy project assignees")
        .populate(taskPreviewPopulate).sort({ dueDate: 1, _id: 1 }).limit(5).lean(),
      Task.find(taskFilter).select("title status priority dueDate updatedAt completedBy project assignees")
        .populate(taskPreviewPopulate).sort({ updatedAt: -1, _id: -1 }).limit(5).lean(),
      WorkspaceMembership.countDocuments({ workspace: workspaceId, status: "Active" }),
      ChatConversation.find({ workspace: workspaceId, participants: userId })
        .select("participants lastMessage updatedAt")
        .populate("participants", "name profile_picture")
        .populate({ path: "lastMessage", select: "text sender createdAt", populate: { path: "sender", select: "name profile_picture" } })
        .sort({ updatedAt: -1, _id: -1 }).limit(5).lean(),
    ]);

    const projectByStatus = Object.fromEntries(["planning", "active", "on_hold", "completed", "cancelled"].map((status) => [status, 0]));
    projectStatusCounts.forEach(({ _id, count }) => { if (_id in projectByStatus) projectByStatus[_id] = count; });
    const taskByStatus = Object.fromEntries(["in-progress", "paused", "done"].map((status) => [status, 0]));
    taskStatusCounts.forEach(({ _id, count }) => { if (_id in taskByStatus) taskByStatus[_id] = count; });

    const totalProjects = Object.values(projectByStatus).reduce((sum, count) => sum + count, 0);
    const totalTasks = Object.values(taskByStatus).reduce((sum, count) => sum + count, 0);
    const taskPreview = (task) => ({
      _id: task._id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      updatedAt: task.updatedAt,
      completedBy: task.completedBy || null,
      project: task.project ? { _id: task.project._id, name: task.project.name } : null,
      assignees: (task.assignees || []).map(({ _id, name, profile_picture }) => ({ _id, name, profile_picture })),
    });

    const data = {
      summary: {
        projects: { total: totalProjects, active: projectByStatus.active, byStatus: projectByStatus },
        tasks: { total: totalTasks, byStatus: taskByStatus, overdue, upcoming, assignedToMe },
        members: { active: activeMembers },
      },
      upcomingTasks: upcomingTasks.map(taskPreview),
      myTasks: myTasks.map(taskPreview),
      recentTasks: recentTasks.map(taskPreview),
      recentConversations: recentConversations.map((conversation) => ({
        _id: conversation._id,
        participants: conversation.participants,
        lastMessage: conversation.lastMessage,
        updatedAt: conversation.updatedAt,
      })),
    };
    return res.status(200).send(sendResponse(true, data, "Workspace dashboard fetched successfully"));
  } catch (error) {
    console.error("Workspace dashboard fetch failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const updateWorkspace = async (req, res) => {
  const user = req.user?.id;
  const { workspaceId } = req.params;
  const { name, description } = req.body;

  if (!user) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  if (!isValidId(workspaceId)) {
    return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
  };

  if (name === undefined && description === undefined) {
    return res.status(400).send(sendResponse(false, null, "At least one field is required"));
  };

  const updates = {};

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).send(sendResponse(false, null, "Valid name is required"));
    };
    updates.name = name.trim();
  };

  if (description !== undefined) {
    if (typeof description !== "string") {
      return res.status(400).send(sendResponse(false, null, "Description must be a string"));
    };
    updates.description = description.trim();
  };

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).send(sendResponse(false, null, "Workspace not found"));
    };

    if (workspace.owner.toString() !== user.toString()) {
      return res.status(403).send(sendResponse(false, null, "Only the owner can update this workspace"));
    };

    const membership = await getActiveMembership(workspaceId, user);

    if (!membership || membership.role !== "Owner") {
      return res.status(403).send(sendResponse(false, null, "Active owner membership required"));
    };

    const updatedWorkspace = await Workspace.findByIdAndUpdate(
      workspaceId,
      { $set: updates },
      { new: true, runValidators: true, }
    ).select("name description background owner createdAt updatedAt");

    return res.status(200).send(sendResponse(true, updatedWorkspace, "Workspace updated successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const deleteWorkspace = async (req, res) => {
  const user = req.user?.id;
  const { workspaceId } = req.params;

  if (!user) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  if (!isValidId(workspaceId)) {
    return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
  };

  let session;

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).send(sendResponse(false, null, "Workspace not found"));
    };

    if (workspace.owner.toString() !== user.toString()) {
      return res.status(403).send(sendResponse(false, null, "Only the owner can delete this workspace"));
    };

    const membership = await getActiveMembership(workspaceId, user);

    if (!membership || membership.role !== "Owner") {
      return res.status(403).send(sendResponse(false, null, "Active owner membership required"));
    };

    const projects = await Project.find({ workspace: workspaceId }).select("_id").lean();
    const projectIds = projects.map((project) => project._id);
    const taskFilter = projectIds.length > 0
      ? { $or: [{ workspace: workspaceId }, { project: { $in: projectIds } }] }
      : { workspace: workspaceId };
    const tasks = await Task.find(taskFilter).select("attachments").lean();
    const attachments = tasks.flatMap((task) => task.attachments || []);
    const { failures } = await destroyCloudinaryAssets(attachments);

    if (failures.length > 0) {
      console.error("Workspace attachment cleanup failed:", failures);
      return res.status(502).send(sendResponse(false, null, "Workspace files could not all be deleted. The workspace and its records were kept; retry the deletion."));
    }

    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      await Task.deleteMany(
        taskFilter,
        { session }
      );

      await Project.deleteMany(
        { workspace: workspaceId },
        { session }
      );

      await WorkspaceInvitation.deleteMany(
        { workspace: workspaceId },
        { session }
      );

      await ChatMessage.deleteMany(
        { workspace: workspaceId },
        { session }
      );

      await ChatConversation.deleteMany(
        { workspace: workspaceId },
        { session }
      );

      await WorkspaceMembership.deleteMany(
        { workspace: workspaceId },
        { session }
      );

      await Workspace.deleteOne(
        { _id: workspaceId },
        { session }
      );
    });

    return res.status(200).send(sendResponse(true, null, "Workspace deleted successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  } finally {
    if (session) await session.endSession();
  }
};

module.exports = {
  createWorkspace,
  getWorkspaces,
  getWorkspaceDashboard,
  updateWorkspace,
  deleteWorkspace,
};
