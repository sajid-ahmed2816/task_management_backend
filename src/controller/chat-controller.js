const mongoose = require("mongoose");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const ChatConversation = require("../models/ChatConversationModel");
const ChatMessage = require("../models/ChatMessageModel");
const User = require("../models/UserModel");
const { sendResponse } = require("../helper/sendResponse");

const validId = (value) => mongoose.isValidObjectId(value);

const requireActiveMember = async (workspaceId, userId) => WorkspaceMembership.exists({
  workspace: workspaceId,
  user: userId,
  status: "Active",
});

const findConversation = async (workspaceId, conversationId, userId) => ChatConversation.findOne({
  _id: conversationId,
  workspace: workspaceId,
  participants: userId,
});

const populateConversation = (query) => query
  .populate("participants", "name email profile_picture")
  .populate({
    path: "lastMessage",
    select: "conversation sender text createdAt",
    populate: { path: "sender", select: "name profile_picture" },
  });

const getActiveWorkspaceUsers = async (req, res) => {
  const { workspaceId } = req.params;
  const userId = req.user?.id;
  if (!validId(workspaceId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
  try {
    if (!(await requireActiveMember(workspaceId, userId))) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    const memberships = await WorkspaceMembership.find({ workspace: workspaceId, status: "Active", user: { $ne: userId } })
      .select("user").populate("user", "name email profile_picture").lean();
    const users = memberships.map(({ user }) => user).filter(Boolean);
    return res.status(200).send(sendResponse(true, { users }, "Active workspace users fetched"));
  } catch (error) {
    console.error("Fetch chat users failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const getConversations = async (req, res) => {
  const { workspaceId } = req.params;
  const userId = req.user?.id;
  if (!validId(workspaceId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
  try {
    if (!(await requireActiveMember(workspaceId, userId))) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    const conversations = await populateConversation(ChatConversation.find({ workspace: workspaceId, participants: userId }))
      .sort({ updatedAt: -1 }).limit(100).lean();
    return res.status(200).send(sendResponse(true, { conversations }, "Conversations fetched"));
  } catch (error) {
    console.error("Fetch conversations failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const createConversation = async (req, res) => {
  const { workspaceId } = req.params;
  const userId = req.user?.id;
  const participantId = req.body?.participantId;
  if (!validId(workspaceId) || !validId(participantId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace or participant ID"));
  if (participantId.toString() === userId?.toString()) return res.status(400).send(sendResponse(false, null, "You cannot start a conversation with yourself"));
  try {
    const memberships = await WorkspaceMembership.find({ workspace: workspaceId, user: { $in: [userId, participantId] }, status: "Active" }).select("user").lean();
    if (memberships.length !== 2) return res.status(403).send(sendResponse(false, null, "Both participants must be active workspace members"));
    const participantKey = [userId.toString(), participantId.toString()].sort().join(":");
    let conversation = await ChatConversation.findOne({ workspace: workspaceId, participantKey });
    let created = false;
    if (!conversation) {
      try {
        conversation = await ChatConversation.create({ workspace: workspaceId, participants: [userId, participantId].sort(), participantKey });
        created = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        conversation = await ChatConversation.findOne({ workspace: workspaceId, participantKey });
      }
    }
    conversation = await populateConversation(ChatConversation.findById(conversation._id)).lean();
    return res.status(created ? 201 : 200).send(sendResponse(true, conversation, created ? "Conversation created" : "Conversation already exists"));
  } catch (error) {
    console.error("Create conversation failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const getMessages = async (req, res) => {
  const { workspaceId, conversationId } = req.params;
  const userId = req.user?.id;
  if (!validId(workspaceId) || !validId(conversationId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace or conversation ID"));
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50;
  const filter = { conversation: conversationId, workspace: workspaceId };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) return res.status(400).send(sendResponse(false, null, "Invalid before timestamp"));
    filter.createdAt = { $lt: before };
  }
  try {
    if (!(await requireActiveMember(workspaceId, userId))) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    if (!(await findConversation(workspaceId, conversationId, userId))) return res.status(404).send(sendResponse(false, null, "Conversation not found"));
    const page = await ChatMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
      .populate("sender", "name profile_picture").lean();
    const hasMore = page.length > limit;
    const messages = page.slice(0, limit).reverse();
    return res.status(200).send(sendResponse(true, { messages, hasMore }, "Messages fetched"));
  } catch (error) {
    console.error("Fetch messages failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const getWorkspaceLinks = async (req, res) => {
  const { workspaceId } = req.params;
  const userId = req.user?.id;
  if (!validId(workspaceId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace ID"));
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 100;
  const match = {
    workspace: new mongoose.Types.ObjectId(workspaceId),
    text: /https?:\/\//i,
  };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (Number.isNaN(before.getTime())) return res.status(400).send(sendResponse(false, null, "Invalid before timestamp"));
    match.createdAt = { $lt: before };
  }
  try {
    if (!(await requireActiveMember(workspaceId, userId))) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    const links = await ChatMessage.aggregate([
      { $match: match },
      { $sort: { createdAt: -1, _id: -1 } },
      { $lookup: { from: ChatConversation.collection.name, localField: "conversation", foreignField: "_id", as: "conversation" } },
      { $unwind: "$conversation" },
      { $match: { "conversation.workspace": new mongoose.Types.ObjectId(workspaceId), "conversation.participants": new mongoose.Types.ObjectId(userId) } },
      { $lookup: { from: User.collection.name, localField: "sender", foreignField: "_id", as: "senderUser" } },
      { $unwind: { path: "$senderUser", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: User.collection.name, localField: "conversation.participants", foreignField: "_id", as: "conversationParticipants" } },
      { $project: {
        _id: 1,
        workspace: 1,
        text: 1,
        createdAt: 1,
        updatedAt: 1,
        sender: { _id: "$senderUser._id", name: "$senderUser.name", profile_picture: "$senderUser.profile_picture" },
        conversation: {
          _id: "$conversation._id",
          workspace: "$conversation.workspace",
          participants: {
            $map: {
              input: "$conversationParticipants",
              as: "participant",
              in: {
                _id: "$$participant._id",
                name: "$$participant.name",
                email: "$$participant.email",
                profile_picture: "$$participant.profile_picture",
              },
            },
          },
          lastMessage: "$conversation.lastMessage",
          createdAt: "$conversation.createdAt",
          updatedAt: "$conversation.updatedAt",
        },
      } },
      { $limit: limit + 1 },
    ]);
    const hasMore = links.length > limit;
    const page = links.slice(0, limit);
    const nextBefore = hasMore && page.length ? page[page.length - 1].createdAt.toISOString() : null;
    return res.status(200).send(sendResponse(true, { links: page, hasMore, nextBefore }, "Workspace links fetched"));
  } catch (error) {
    console.error("Fetch workspace chat links failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

const sendMessage = async (req, res) => {
  const { workspaceId, conversationId } = req.params;
  const userId = req.user?.id;
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!validId(workspaceId) || !validId(conversationId)) return res.status(400).send(sendResponse(false, null, "Invalid workspace or conversation ID"));
  if (!text || text.length > 4000) return res.status(400).send(sendResponse(false, null, "Message must contain 1 to 4000 characters"));
  try {
    if (!(await requireActiveMember(workspaceId, userId))) return res.status(403).send(sendResponse(false, null, "Active workspace membership required"));
    const conversation = await findConversation(workspaceId, conversationId, userId);
    if (!conversation) return res.status(404).send(sendResponse(false, null, "Conversation not found"));
    const recipientIds = conversation.participants.filter((participant) => participant.toString() !== userId.toString());
    const recipientMemberships = await WorkspaceMembership.countDocuments({ workspace: workspaceId, user: { $in: recipientIds }, status: "Active" });
    if (recipientMemberships !== recipientIds.length) return res.status(403).send(sendResponse(false, null, "All conversation participants must be active workspace members"));
    const message = await ChatMessage.create({ workspace: workspaceId, conversation: conversationId, sender: userId, text });
    conversation.lastMessage = message._id;
    await conversation.save();
    await message.populate("sender", "name profile_picture");
    const io = req.app.get("io");
    if (io) {
      try {
        const room = `chat:${conversationId}`;
        const sockets = await io.in(room).fetchSockets();
        await Promise.all(sockets.map(async (socket) => {
          const active = await WorkspaceMembership.exists({ workspace: workspaceId, user: socket.data.userId, status: "Active" });
          if (active) socket.emit("chat:new-message", { message: message.toObject() });
          else await socket.leave(room);
        }));
      } catch (socketError) {
        console.error("Chat realtime delivery failed:", socketError);
      }
    }
    return res.status(201).send(sendResponse(true, message, "Message sent"));
  } catch (error) {
    console.error("Send chat message failed:", error);
    return res.status(500).send(sendResponse(false, null, "Internal server error"));
  }
};

module.exports = { getActiveWorkspaceUsers, getConversations, createConversation, getMessages, getWorkspaceLinks, sendMessage };
