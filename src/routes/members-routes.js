const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/index");
const {
  listWorkspaceMembers,
  listWorkspaceInvitations,
  previewWorkspaceInvitation,
  createWorkspaceInvitation,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
  acceptWorkspaceInvitation,
  removeWorkspaceMember,
} = require("../controller/members-controller");

router.use(authMiddleware);

router.get("/invitations/preview", previewWorkspaceInvitation);
router.get("/:workspaceId/members/get", listWorkspaceMembers);
router.get("/:workspaceId/invitations/get", listWorkspaceInvitations);
router.post("/:workspaceId/invitations/invite", createWorkspaceInvitation);
router.post("/:workspaceId/invitations/:invitationId/resend", resendWorkspaceInvitation);
router.post("/invitations/accept", acceptWorkspaceInvitation);
router.delete("/:workspaceId/members/delete/:memberId", removeWorkspaceMember);
router.delete("/:workspaceId/invitations/revoke/:invitationId", revokeWorkspaceInvitation);

module.exports = router;