
const mongoose = require("mongoose");
const Workspace = require("../models/WorkspaceModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const { sendResponse } = require("../helper/sendResponse");

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

    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      await Workspace.deleteOne(
        { _id: workspaceId },
        { session }
      );

      await WorkspaceMembership.deleteMany(
        { workspace: workspaceId },
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
  updateWorkspace,
  deleteWorkspace,
};
