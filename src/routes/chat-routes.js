const express = require("express");
const authenticate = require("../middleware/index");
const { getActiveWorkspaceUsers, getConversations, createConversation, getMessages, getWorkspaceLinks, sendMessage } = require("../controller/chat-controller");
const { getLinkPreview } = require("../controller/link-preview-controller");

const router = express.Router();
router.use(authenticate);
router.get("/:workspaceId/users", getActiveWorkspaceUsers);
router.get("/:workspaceId/links", getWorkspaceLinks);
router.get("/:workspaceId/link-preview", getLinkPreview);
router.get("/:workspaceId/conversations", getConversations);
router.post("/:workspaceId/conversations", createConversation);
router.get("/:workspaceId/conversations/:conversationId/messages", getMessages);
router.post("/:workspaceId/conversations/:conversationId/messages", sendMessage);

module.exports = router;
