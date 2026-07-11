# Known Issues - Frontend (dice-app)
**Timepoint:** 2026-07-11T11:52:38+01:00

The following issues were identified during the frontend audit on July 11, 2026:

## 1. Render-Blocking External Assets in `<head>`
* **Description:** FontAwesome CSS (`all.min.css`), Google Fonts (`Outfit`), and the Telegram WebApp SDK are loaded synchronously in the `<head>`, preventing the browser from performing First Contentful Paint until downloaded.
* **Location:** [index.html](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/index.html)
* **Status:** Pending Optimization

## 2. Excessive Startup API Requests (5 Parallel Requests)
* **Description:** The application fires 5 parallel API calls on initialization, which saturates mobile networks (typical of Telegram WebApps on phones):
  1. `GET /api/user` ([fetchUserProfile](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L298))
  2. `GET /api/rooms` ([fetchActiveRooms](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L412))
  3. `WS /api/ws/lobby` ([connectLobbySocket](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L968))
  4. `GET /api/notifications` ([fetchNotifications](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L151))
  5. `GET /api/leaderboard/my-league` ([fetchAndUpdateLeague](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L1652))
* **Location:** [app.js](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js)
* **Status:** Pending optimization (recommend combining into a single `/api/init` bootstrap call)

## 3. Redundant / Junk Variables (`gameSocket`)
* **Description:** The `gameSocket` variable is declared, set to null, and closed in multiple places but is never instantiated with `new WebSocket`.
* **Location:** [app.js:L23](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L23)
* **Status:** Pending Cleanup

## 4. WebSocket infinite reconnect loop
* **Description:** Reconnection on close runs every 3 seconds indefinitely without exponential backoff or online connectivity check (`navigator.onLine`), creating unnecessary CPU overhead and battery drain when server is offline.
* **Location:** [app.js:L990-L993](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L990-L993)
* **Status:** Pending Fix

## 5. Layout Thrashing via full `innerHTML` re-render
* **Description:** Whenever rooms are added or deleted via WebSocket, the lobby DOM is completely cleared and re-created via `innerHTML = ...`, leading to heavy Layout Reflow/Repaint on low-end devices.
* **Location:** `renderRooms(rooms)` in [app.js](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js)
* **Status:** Pending Optimization

## 6. Delayed first polling check in `startRoomPolling`
* **Description:** The function waits 10 seconds before executing the first status check, causing a potential delay in starting matches even if the opponent has already joined.
* **Location:** [app.js:L1145](file:///F:/EMERALDFORGE/emeraldforgestudio/dice-app/app.js#L1145)
* **Status:** Pending Fix
