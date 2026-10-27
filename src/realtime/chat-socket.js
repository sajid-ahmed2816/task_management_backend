const jwt = require("jsonwebtoken");
const WorkspaceMembership = require("../models/WorkspaceMembershipModel");
const ChatConversation = require("../models/ChatConversationModel");

const registerChatSocket = (io) => {
  io.use((socket, next) => {
    try {
      const rawToken = socket.handshake.auth?.token
        || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!rawToken) return next(new Error("Authentication required"));
      const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
      if (!decoded?.id) return next(new Error("Invalid authentication token"));
      socket.data.userId = decoded.id;
      return next();
    } catch (error) {
      return next(new Error("Invalid or expired authentication token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("chat:join", async (payload = {}, acknowledge) => {
      try {
        const { workspaceId, conversationId } = payload;
        if (!workspaceId || !conversationId) throw new Error("workspaceId and conversationId are required");
        const membership = await WorkspaceMembership.exists({ workspace: workspaceId, user: socket.data.userId, status: "Active" });
        if (!membership) throw new Error("Active workspace membership required");
        const conversation = await ChatConversation.findOne({ _id: conversationId, workspace: workspaceId, participants: socket.data.userId }).select("_id participants").lean();
        if (!conversation) throw new Error("Conversation not found");
        const otherParticipants = conversation.participants.filter((id) => id.toString() !== socket.data.userId.toString());
        const activeCount = await WorkspaceMembership.countDocuments({ workspace: workspaceId, user: { $in: otherParticipants }, status: "Active" });
        if (activeCount !== otherParticipants.length) throw new Error("All conversation participants must be active workspace members");
        const room = `chat:${conversationId}`;
        await socket.join(room);
        if (typeof acknowledge === "function") acknowledge({ ok: true, conversationId });
      } catch (error) {
        socket.emit("chat:error", { message: error.message || "Could not join conversation" });
        if (typeof acknowledge === "function") acknowledge({ ok: false, message: error.message || "Could not join conversation" });
      }
    });

    socket.on("chat:leave", async (payload = {}) => {
      if (payload.conversationId) await socket.leave(`chat:${payload.conversationId}`);
    });
  });
};

module.exports = registerChatSocket;
