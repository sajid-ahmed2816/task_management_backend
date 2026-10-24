const crypto = require("crypto");
const mongoose = require("mongoose");
const Workspace = require("../models/WorkspaceModel");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const WorkspaceInvitation = require("../models/WorkspaceInvitationModel");
const User = require("../models/UserModel");
const { sendResponse } = require("../helper/sendResponse");
const { sendWorkspaceInvitationEmail } = require("../helper/workspaceInvitationEmail");

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const isValidId = (id) => mongoose.isValidObjectId(id);
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requireOwner = async (workspaceId, userId) => {
  if (!isValidId(workspaceId)) {
    return { error: [400, "Invalid workspace ID"] };
  };

  const workspace = await Workspace.findById(workspaceId).select("name owner");

  if (!workspace) {
    return { error: [404, "Workspace not found"] };
  };

  const membership = await WorkspaceMembership.findOne({
    workspace: workspaceId,
    user: userId,
    status: "Active",
    role: "Owner"
  });

  if (!membership || workspace.owner.toString() !== userId.toString()) {
    return { error: [403, "Only the workspace owner can manage members and invitations"] };
  };

  return { workspace };
};

const listWorkspaceMembers = async (req, res) => {
  const userId = req.user?.id;
  const { workspaceId } = req.params;

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  try {
    if (!isValidId(workspaceId)) {
      return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
    };

    const active = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: userId,
      status: "Active"
    });

    if (!active) {
      return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    };

    const members = await WorkspaceMembership.find({
      workspace: workspaceId,
      status: "Active"
    }).populate({
      path: "user",
      select: "name email profile_picture"
    }).sort({ role: 1, createdAt: 1 });

    const data = members.filter((membership) => membership.user).map((membership) => ({
      _id: membership._id,
      user: membership.user,
      role: membership.role,
      joinedAt: membership.createdAt,
    }));

    return res.status(200).send(sendResponse(true, data, "Workspace members fetched successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const listWorkspaceInvitations = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  try {
    const access = await requireOwner(req.params.workspaceId, userId);

    if (access.error) {
      return res.status(access.error[0]).send(sendResponse(false, null, access.error[1]));
    };

    await WorkspaceInvitation.updateMany(
      { workspace: access.workspace._id, status: "Pending", expiresAt: { $lte: new Date() } },
      { $set: { status: "Expired" } }
    );

    const invitations = await WorkspaceInvitation.find({
      workspace: access.workspace._id
    }).populate({
      path: "invitedBy",
      select: "name email"
    }).select(
      "email status expiresAt acceptedAt revokedAt lastSentAt createdAt invitedBy"
    ).sort({ createdAt: -1 });

    return res.status(200).send(
      sendResponse(true, invitations, "Workspace invitations fetched successfully")
    );
  } catch (error) {
    console.error("List workspace invitations failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const previewWorkspaceInvitation = async (req, res) => {
  const authenticatedEmail = normalizeEmail(req.user?.email);
  const token = String(req.query?.token || "");

  if (!authenticatedEmail) {
    return res.status(401).send(sendResponse(false, null, "Authenticated email is required"));
  };

  if (!token || token.length > 256) {
    return res.status(400).send(sendResponse(false, null, "A valid invitation token is required"));
  };

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invitation = await WorkspaceInvitation.findOne({ tokenHash })
      .populate({ path: "workspace", select: "name" })
      .populate({ path: "invitedBy", select: "name email" });

    if (!invitation) {
      return res.status(404).send(sendResponse(false, null, "Invitation link is invalid or has already been used"));
    };

    if (normalizeEmail(invitation.email) !== authenticatedEmail) {
      return res.status(403).send(sendResponse(false, null, "Sign in with the email address that received this invitation"));
    };

    if (invitation.status !== "Pending") {
      return res.status(410).send(sendResponse(false, null, "This invitation is no longer active"));
    };

    if (invitation.expiresAt <= new Date()) {
      invitation.status = "Expired";
      await invitation.save();
      return res.status(410).send(sendResponse(false, null, "This invitation has expired"));
    };

    if (!invitation.workspace) {
      return res.status(404).send(sendResponse(false, null, "The invited workspace no longer exists"));
    };

    const data = {
      invitationId: invitation._id,
      workspace: {
        id: invitation.workspace._id,
        name: invitation.workspace.name,
      },
      invitedBy: invitation.invitedBy ? {
        name: invitation.invitedBy.name,
        email: invitation.invitedBy.email,
      } : null,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
    };

    return res.status(200).send(sendResponse(true, data, "Invitation preview fetched successfully"));
  } catch (error) {
    console.error("Preview workspace invitation failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const createWorkspaceInvitation = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  const email = normalizeEmail(req.body?.email);

  if (!emailPattern.test(email)) {
    return res.status(400).send(sendResponse(false, null, "A valid email address is required"));
  };

  try {
    const access = await requireOwner(req.params.workspaceId, userId);
    if (access.error) {
      return res.status(access.error[0]).send(sendResponse(false, null, access.error[1]));
    };

    if (normalizeEmail(req.user.email) === email) {
      return res.status(400).send(sendResponse(false, null, "You are already the workspace owner"));
    };

    const existingUser = await User.findOne({ email }).select("_id");

    if (existingUser) {
      const activeMembership = await WorkspaceMembership.findOne({
        workspace: access.workspace._id,
        user: existingUser._id,
        status: "Active"
      });

      if (activeMembership) {
        return res.status(409).send(
          sendResponse(false, null, "This person is already a workspace member")
        );
      };
    };

    let invitation = await WorkspaceInvitation.findOne({
      workspace: access.workspace._id,
      email,
      status: "Pending"
    });

    if (invitation && invitation.expiresAt > new Date()) {
      return res.status(409).send(
        sendResponse(false, null, "A pending invitation already exists for this email")
      );
    };

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const now = new Date();

    if (invitation) {
      invitation.status = "Expired";
      await invitation.save();
    };

    invitation = new WorkspaceInvitation({
      workspace: access.workspace._id,
      email,
      invitedBy: userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
      lastSentAt: now,
    });

    await invitation.save();
    const inviter = await User.findById(userId).select("name");
    try {
      await sendWorkspaceInvitationEmail({
        email,
        workspaceName: access.workspace.name,
        inviterName: inviter?.name,
        token: rawToken
      });
    } catch (emailError) {
      await WorkspaceInvitation.deleteOne({ _id: invitation._id });
      return res.status(502).send(
        sendResponse(false, null, "Invitation email could not be sent. Check the email configuration and try again.")
      );
    };

    const data = await WorkspaceInvitation.findById(
      invitation._id
    ).populate({
      path: "invitedBy",
      select: "name email"
    }).select(
      "email status expiresAt acceptedAt revokedAt lastSentAt createdAt invitedBy"
    );

    return res.status(201).send(sendResponse(true, data, "Invitation sent successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const resendWorkspaceInvitation = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  try {
    const access = await requireOwner(req.params.workspaceId, userId);

    if (access.error) {
      return res.status(access.error[0]).send(sendResponse(false, null, access.error[1]));
    };

    if (!isValidId(req.params.invitationId)) {
      return res.status(400).send(sendResponse(false, null, "Invalid invitation ID"));
    };

    const invitation = await WorkspaceInvitation.findOne({
      _id: req.params.invitationId,
      workspace: access.workspace._id,
      status: "Pending"
    });

    if (!invitation) {
      return res.status(404).send(sendResponse(false, null, "Pending invitation not found"));
    };

    const rawToken = crypto.randomBytes(32).toString("hex");
    invitation.tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    invitation.expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
    invitation.lastSentAt = new Date();
    await invitation.save();

    const inviter = await User.findById(userId).select("name");

    try {
      await sendWorkspaceInvitationEmail({
        email: invitation.email,
        workspaceName: access.workspace.name,
        inviterName: inviter?.name,
        token: rawToken
      });
    } catch (emailError) {
      return res.status(502).send(
        sendResponse(false, null, "Invitation email could not be sent. The previous link is no longer valid.")
      );
    };

    const data = await WorkspaceInvitation.findById(
      invitation._id
    ).populate({
      path: "invitedBy",
      select: "name email"
    }).select(
      "email status expiresAt acceptedAt revokedAt lastSentAt createdAt invitedBy"
    );

    return res.status(200).send(sendResponse(true, data, "Invitation resent successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const revokeWorkspaceInvitation = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  try {
    const access = await requireOwner(req.params.workspaceId, userId);

    if (access.error) {
      return res.status(access.error[0]).send(sendResponse(false, null, access.error[1]));
    };

    if (!isValidId(req.params.invitationId)) {
      return res.status(400).send(sendResponse(false, null, "Invalid invitation ID"));
    };

    const invitation = await WorkspaceInvitation.findOneAndUpdate(
      { _id: req.params.invitationId, workspace: access.workspace._id, status: "Pending" },
      { $set: { status: "Revoked", revokedAt: new Date() }, $unset: { tokenHash: 1 } },
      { new: true }
    ).select("email status expiresAt acceptedAt revokedAt lastSentAt createdAt");

    if (!invitation) {
      return res.status(404).send(sendResponse(false, null, "Pending invitation not found"));
    };

    return res.status(200).send(sendResponse(true, invitation, "Invitation revoked successfully"));
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  };
};

const acceptWorkspaceInvitation = async (req, res) => {
  const userId = req.user?.id;
  const token = String(req.body?.token || "");

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  if (!token || token.length > 256) {
    return res.status(400).send(sendResponse(false, null, "A valid invitation token is required"));
  };

  try {
    const user = await User.findById(userId).select("email name profile_picture");

    if (!user) {
      return res.status(401).send(sendResponse(false, null, "User not found"));
    };

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invitation = await WorkspaceInvitation.findOne({ tokenHash }).select("+tokenHash");

    if (!invitation) {
      return res.status(404).send(sendResponse(false, null, "Invitation link is invalid or has already been used"));
    };

    if (invitation.status !== "Pending") {
      return res.status(410).send(sendResponse(false, null, "This invitation is no longer active"));
    };

    if (invitation.expiresAt <= new Date()) {
      invitation.status = "Expired";
      await invitation.save();
      return res.status(410).send(sendResponse(false, null, "This invitation has expired"));
    };

    if (normalizeEmail(user.email) !== invitation.email) {
      return res.status(403).send(
        sendResponse(false, null, "Sign in with the email address that received this invitation")
      );
    };

    const session = await mongoose.startSession();
    let result;

    try {
      await session.withTransaction(async () => {
        const claimed = await WorkspaceInvitation.findOneAndUpdate(
          { _id: invitation._id, status: "Pending", expiresAt: { $gt: new Date() } },
          { $set: { status: "Accepted", acceptedAt: new Date() }, $unset: { tokenHash: 1 } },
          { new: true, session }
        );

        if (!claimed) {
          throw Object.assign(new Error("Invitation link is no longer active"), { statusCode: 410 });
        };

        result = await WorkspaceMembership.findOneAndUpdate(
          { workspace: invitation.workspace, user: userId },
          {
            $set: { status: "Active", role: "Member", removedAt: null },
            $setOnInsert: { workspace: invitation.workspace, user: userId }
          },
          { new: true, upsert: true, runValidators: true, session }
        ).populate({
          path: "workspace",
          select: "name description background owner createdAt updatedAt"
        });
      });
    } finally {
      await session.endSession();
    }
    return res.status(200).send(sendResponse(true, result, "You joined the workspace successfully"));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).send(sendResponse(false, null, error.message));
    };
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const removeWorkspaceMember = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).send(sendResponse(false, null, "Unauthorized"));
  };

  try {
    const access = await requireOwner(req.params.workspaceId, userId);

    if (access.error) {
      return res.status(access.error[0]).send(sendResponse(false, null, access.error[1]));
    };

    if (!isValidId(req.params.memberId)) {
      return res.status(400).send(sendResponse(false, null, "Invalid member ID"));
    };

    if (access.workspace.owner.toString() === req.params.memberId) {
      return res.status(400).send(sendResponse(false, null, "The workspace owner cannot be removed"));
    };

    const membership = await WorkspaceMembership.findOneAndUpdate(
      { workspace: access.workspace._id, user: req.params.memberId, status: "Active", role: "Member" },
      { $set: { status: "Inactive", removedAt: new Date() } },
      { new: true }
    );

    if (!membership) {
      return res.status(404).send(sendResponse(false, null, "Active workspace member not found"));
    };
    return res.status(200).send(
      sendResponse(
        true,
        {
          membershipId: membership._id,
          userId: membership.user,
          status: membership.status
        },
        "Workspace member removed successfully"
      )
    );
  } catch (error) {
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

module.exports = {
  listWorkspaceMembers,
  listWorkspaceInvitations,
  previewWorkspaceInvitation,
  createWorkspaceInvitation,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
  acceptWorkspaceInvitation,
  removeWorkspaceMember,
};
