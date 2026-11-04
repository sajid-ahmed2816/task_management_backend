# Todo Workspace Backend

Express 5 API for Todo Workspace. It provides authentication, workspaces, members and invitations, projects, tasks and attachments, chat, link previews, and notifications. MongoDB stores application data; Cloudinary stores uploaded assets; Nodemailer sends verification, password-change, and invitation emails.

## Local development

Requirements: Node.js 18 or later, npm, a reachable MongoDB database, Cloudinary credentials, and an email account configured for SMTP through Gmail.

1. Install dependencies with `npm install`.
2. Create a local `.env` file in this directory and set the environment variables listed below. Keep it out of source control.
3. Start the API with `npm start` (equivalent to `node index.js`). The API listens on `PORT`, or `3000` when `PORT` is unset.

The server waits for MongoDB before listening locally. On a serverless invocation it connects lazily on the first API request or Socket.IO connection and reuses the connection while that process remains warm.

## Environment variables

Set these in the local `.env` file or the deployment environment. Do not commit credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | Yes | MongoDB connection URI for Mongoose. |
| `JWT_SECRET` | Yes | Secret used to sign and verify API and Socket.IO bearer tokens. |
| `CLOUDINARY_CLOUD_NAME` | Yes for uploads | Cloudinary account cloud name. |
| `CLOUDINARY_API_KEY` | Yes for uploads | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Yes for uploads | Cloudinary API secret. |
| `EMAIL_USER` | Yes for email | Gmail sender/account address. |
| `EMAIL_PASS` | Yes for email | Gmail app password or configured SMTP password. |
| `FRONTEND_URL` | For invitation links | Frontend base URL used to build `/accept-invitation` links. |
| `CLIENT_URL` | Optional fallback | Used for invitation links only when `FRONTEND_URL` is unset. |
| `PORT` | No | Local HTTP port; defaults to `3000`. The platform supplies this when applicable. |

The current Express CORS middleware accepts browser origins broadly. Socket.IO also enables credentialed cross-origin connections. `FRONTEND_URL` does not currently restrict CORS origins.

## API and authentication

All REST routes are mounted under `/api`. Protected routes use `Authorization: Bearer <JWT>`. Most responses use `{ status, data, message }`; the standalone upload route has its own response shape.

| Prefix | Main routes | Access |
| --- | --- | --- |
| `/api/auth` | `POST /signup`, `/login`, `/login/google`, `/verify-otp`, `/resend-otp`; `GET /profile`; `PATCH /profile`; `POST /profile/password/request-otp`, `/profile/password/verify-otp` | Signup/login/verification are public; profile and password-change routes require a JWT. |
| `/api` | `POST /uploads` | JWT; general image upload endpoint. |
| `/api/workspaces` | `POST /add`, `GET /get`, `GET /:workspaceId/dashboard`, `PATCH /update/:workspaceId`, `DELETE /delete/:workspaceId` | JWT. |
| `/api/workspace-members` | Member list/remove and invitation preview/list/invite/resend/accept/revoke routes | JWT. See `src/routes/members-routes.js` for exact path parameters. |
| `/api/projects` | Workspace-scoped list/get/add/update/delete | JWT. |
| `/api/tasks` | Workspace-scoped list/get/add/update/delete, comments, subtasks, attachment upload/delete/download | JWT. |
| `/api/chats` | Workspace users, links and previews, conversations, messages | JWT. |
| `/api/notifications` | List, unread count, mark one read, mark all read | JWT. |

Workspace membership is stored separately from workspace ownership. Projects belong to a workspace; tasks belong to projects and workspaces and can include assignees, comments, subtasks, and Cloudinary attachments. Invitations are stored with a hashed, single-use token and an expiry. Chat conversations and messages, and durable notifications, are also stored in MongoDB.

## Uploads and email

Task attachments are sent as multipart field `files`, up to 10 files per request and 25 MB per file in the application configuration. The supported formats are configured in `src/routes/task-routes.js`; Cloudinary stores images and non-image assets using their resource types. Profile images are limited to 5 MB. The separate `POST /api/uploads` endpoint currently accepts images only (JPG and PNG), despite its generic name.

**Vercel upload limit:** Vercel Functions currently cap the complete request body at 4.5 MB. That platform limit is lower than this app's 25 MB per-file Multer limit, so uploads larger than the platform limit will be rejected before this Express code can stream them to Cloudinary. For larger attachments on Vercel, use a browser-to-Cloudinary signed upload flow (or another direct-to-object-storage flow), then send the resulting asset metadata to the API. The current server-side Multer upload flow remains suitable for local development and deployments without that request-body cap.

Email delivery uses Gmail through Nodemailer. Invitation links point to `${FRONTEND_URL}/accept-invitation?token=...`; the frontend must provide that page and pass the token to the invitation acceptance endpoint.

## Realtime chat and notifications

Socket.IO is attached to the same Node HTTP server as Express, at the default `/socket.io` path. Clients authenticate with a JWT in `auth.token` or an `Authorization: Bearer` handshake header. The server automatically joins `user:<userId>`; authorized chat clients join `chat:<conversationId>` using `chat:join` with `workspaceId` and `conversationId`, and can leave with `chat:leave`.

Server events include `chat:new-message`, `chat:error`, `notification:new`, and `notification:unread-count`. Notifications and chat messages are persisted in MongoDB; socket delivery is an immediate update.

Vercel supports WebSockets on Functions when Fluid compute is enabled, and Socket.IO is supported when the client uses the WebSocket transport directly. Vercel documents that a connection stays pinned to one function instance, but a reconnect can land on another instance. This project currently uses Socket.IO's in-memory adapter, so room membership, `fetchSockets()`, and broadcasts are local to an instance. For reliable delivery across instances/deployments, configure a shared Socket.IO adapter/pub-sub store such as Redis, or host realtime connections on a shared realtime service. The client must use `transports: ["websocket"]` on Vercel, reconnect when a connection closes, and rejoin rooms; Vercel Function duration limits can close long-lived connections.

## Vercel deployment

The repository root `index.js` is the Express entry point. It exports the Node HTTP server, which carries both the Express app and Socket.IO, and only calls `listen()` when run directly. Vercel can therefore invoke the exported server while local `npm start` continues to open a normal HTTP listener. No `vercel.json` is required for the current root layout.

1. Import this backend directory as the Vercel project root (or set the project root to `backend` in a monorepo).
2. Add the required environment variables above to the Vercel project for each environment.
3. Enable Fluid compute for the project to use WebSockets. Keep the frontend API base URL pointed at the deployed backend origin with the `/api` prefix.
4. Deploy through the connected Git integration or Vercel CLI. Use `vercel dev` to exercise Vercel's local function routing if desired; ordinary local development remains `npm start`.
5. Confirm API requests, email links, Cloudinary uploads within the platform payload limit, and Socket.IO reconnect behavior in a preview deployment.

Vercel treats the Express app as one Function. Function duration and payload limits therefore apply; in particular, oversized upload bodies and long-running HTTP work need an external/direct upload or background processing design. Current WebSocket support and Function limits are described in [Vercel's Express guide](https://vercel.com/docs/frameworks/backend/express), [WebSocket guide](https://vercel.com/docs/functions/websockets), and [Function limits](https://vercel.com/docs/functions/limitations).

## Code layout

- `index.js`: Express setup, Socket.IO server, MongoDB connection, and local entry point.
- `src/routes` and `src/controller`: REST route definitions and request handlers.
- `src/models`: Mongoose schemas for users, workspaces, memberships, invitations, projects, tasks, chat, and notifications.
- `src/middleware`: JWT authentication.
- `src/realtime`: Socket.IO authentication, room membership, and realtime events.
- `src/helper` and `src/config`: email, notifications, pagination, Cloudinary, and service setup.
- `src/migrations`: one-off database migration scripts; run only intentionally against the intended database.

There is no configured automated test suite yet; `npm test` is the default placeholder script and exits with an error.
