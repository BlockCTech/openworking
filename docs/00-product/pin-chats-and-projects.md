# Pin chats & projects (as-built)

> **Loại tài liệu:** As-built reference cho tính năng ghim (pin) chat session và project trong sidebar.
> **Nguồn code:** `src/pin-registry.js`, `src/project-registry.js`, `src/main.js`, `src/preload.js`, `src/renderer.js`, `src/styles.css`.
> **Test:** `test/pin-registry.test.js`, `test/project-registry.test.js`.
> **Liên quan:** IPC surface & 3-process model ở [`../01-architecture/architecture-overview.md`](../01-architecture/architecture-overview.md).

## Context

Sidebar liệt kê chat (session) theo thứ tự server OpenCode trả về (mới-cập-nhật trước) và project theo thứ tự `ProjectRegistry`. Người dùng không có cách giữ một chat/project quan trọng trên đầu. Tính năng **pin** gom mọi mục đã ghim vào **một mục "Pinned" duy nhất ở đầu sidebar** (header `.side-label` riêng, phía trên mục "Projects"):

- **Chat session đã ghim** — hiển thị **phẳng** (không nhóm theo project), trộn chung từ **mọi project**, kể cả project chưa mở runtime.
- **Project đã ghim** — hiển thị dưới dạng **accordion đầy đủ** (mở ra thấy chat list). Project đã ghim **không** còn xuất hiện ở mục "Projects" bên dưới (tránh trùng).

**Ranh giới local-first:** pin chỉ là **tuỳ chọn cục bộ** lưu dưới Electron `userData`, không đồng bộ cloud, không chia sẻ giữa máy/người dùng — đúng product boundary (xem `openworking-business-principles.md`).

Điểm khác nhau cốt lõi quyết định nơi lưu cờ pin:

| | Sở hữu dữ liệu | Nơi lưu cờ `pinned` |
|---|---|---|
| **Chat session** | OpenCode core (fetch qua HTTP) | Store app-side riêng (`PinRegistry`) |
| **Project** | App (`ProjectRegistry` / `projects.json`) | Ngay trên bản ghi project |

## Design

### Chat pins

**Vì sao phải cache metadata.** Runtime chỉ phục vụ **một project tại một thời điểm** — `RuntimeProcessManager.listSessions` chỉ trả session của project đang active, và `state.sessionsByProject` chỉ giữ project đã mở. Do đó danh sách Pinned phẳng-xuyên-project **không thể** dựng từ runtime; nó phải đến từ store có sẵn metadata.

**Store — `src/pin-registry.js` (`PinRegistry`).** Session do OpenCode core sở hữu nên cờ pin nằm ở file riêng, kèm metadata đủ để render khi project chưa mở:

- File: `userData/pinned-sessions.json`, shape `{ pins: { [sessionId]: { projectId, title, updatedAt } } }`.
- `list()` → mảng `{ sessionId, projectId, title, updatedAt }` (ENOENT → `[]`); **dung nạp legacy** `true` → `{ projectId: null, title: "", updatedAt: null }`.
- `set(sessionId, pinned, meta)` → ghim thì lưu `{ projectId, title, updatedAt }`, bỏ ghim thì xoá; trả mảng đầy đủ.

**IPC.** `src/main.js`: `pins:list` → `pinRegistry.list()`; `pins:set` → `pinRegistry.set(sessionId, pinned, meta)`. `src/preload.js` expose `window.openworking.pins` (`list`, `set(id, pinned, meta)`).

**Renderer (`src/renderer.js`).**
- `state.pinnedSessions: Map<sessionId, { projectId, title, updatedAt }>`, hydrate trong `loadInitialState` qua `pinsToMap(...)`.
- `renderPinnedSection()` dựng mục Pinned: **session phẳng trước** (ưu tiên object session live nếu `state.sessionsByProject[projectId]` đã có để lấy title/time/busy mới; nếu chưa thì fallback metadata đã lưu) → tái dùng `renderSessionRow({ id: projectId }, sessionLike)`; rồi tới **accordion project đã ghim** (`renderProjectGroup`).
- Ghim/bỏ ghim qua menu `⋯` của session (item `[data-session-pin]` + các `data-pin-*` project/title/updated để `togglePin` lưu metadata) — **không có icon pin inline** trên row.
- Click một pinned session của project khác → `selectSession(projectId, sessionId)` tự `openProject` rồi chọn session (đã hỗ trợ cross-project sẵn). Nếu `projectId` rỗng/không tồn tại (pin legacy hoặc project đã xoá) → toast cảnh báo thay vì im lặng.
- `renderProjectGroup` **loại** session đã ghim khỏi chat list của accordion (tránh hiện hai lần — kể cả khi project đó cũng được ghim).

### Project pins

**Store — `src/project-registry.js`.** Project là app-owned nên cờ `pinned` nằm thẳng trên bản ghi trong `projects.json`:

- `setPinned(projectId, pinned)` — map bản ghi, set `pinned: Boolean(pinned)`, `save()`; mô phỏng `rename`/`touch`.
- `add()` giữ lại `existing?.pinned` khi re-add đúng folder → re-add không mất pin.
- Bản ghi cũ thiếu `pinned` ⇒ falsy ⇒ không cần migration.

**IPC.** `projects:setPinned` (`src/main.js`) → `projectRegistry.setPinned(...)`; expose qua `window.openworking.projects.setPinned`.

**Renderer (`src/renderer.js`).**
- `renderPinnedSection()` render project đã ghim (`state.projects.filter(p => p.pinned)`) dưới dạng accordion đầy đủ qua `renderProjectGroup` — ngay dưới danh sách pinned session.
- `renderProjectList()` (mục "Projects") chỉ render project **chưa ghim** (`filter(p => !p.pinned)`) để không trùng.
- `hasPinnedItems()` quyết định có render header "Pinned" hay không (có ≥1 pinned session hoặc pinned project).
- `renderProjectGroup`: ghim/bỏ ghim qua menu `⋯` (item đầu **"Pin project" / "Unpin project"**, `[data-project-pin]`) — sidebar **không** còn badge pin trên header. Màn Projects (settings) vẫn giữ badge `.proj-pin-badge` + nút pin trên card.
- Handler `[data-project-pin]` gọi `toggleProjectPin(...)` → `projects.setPinned` → reload `state.projects` → đóng menu → `render()`.
- Màn **Projects** (`renderProjectsScreen`) dùng `sortProjectsByPin` + nút pin trên card cho nhất quán.

## Cross-cutting / Security

- **Chỉ là preference cục bộ:** cả hai store nằm dưới `userData`; không rời máy, không qua mạng. Metadata cache (title/projectId/updatedAt) cũng chỉ là dữ liệu cục bộ.
- **Id mồ côi vô hại:** id của session/project đã xoá còn sót trong store chỉ đơn giản không khớp entry sống — không gây crash. Pinned session có `projectId` null (pin legacy) khi click sẽ không mở được project; người dùng ghim lại để khôi phục metadata.
- **Ranh giới renderer↔main giữ nguyên:** mọi thao tác pin đi qua allowlist `window.openworking` (`pins.*`, `projects.setPinned`); không forward object thô.
- **Idempotent:** `set`/`setPinned` ghi đè trạng thái mong muốn nên gọi lặp an toàn.

## References

- Kiến trúc & IPC surface: [`../01-architecture/architecture-overview.md`](../01-architecture/architecture-overview.md).
- Product boundary local-first: `../../openworking-business-principles.md`.
- Code: `src/pin-registry.js`, `src/project-registry.js`, `src/main.js` (handlers `pins:*`, `projects:setPinned`), `src/preload.js`, `src/renderer.js` (`renderPinnedSection`, `hasPinnedItems`, `renderProjectList`, `renderSessionRow`, `pinsToMap`, `togglePin`, `toggleProjectPin`), `src/styles.css` (`.pinned-list`, `.proj-pin-badge`).
- Test: `test/pin-registry.test.js`, `test/project-registry.test.js`.
