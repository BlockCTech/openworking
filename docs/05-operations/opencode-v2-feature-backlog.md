# OpenCode Core v2 — Feature Backlog

> **Loại tài liệu:** Backlog vận hành cho các capability OpenCode Core v2 chưa được đưa lên UI.
> **Phạm vi:** `desktop-client/`; không phải cam kết release date.
> **Cách dùng:** Chỉ đánh dấu `[x]` sau khi acceptance signal được kiểm chứng bằng test hoặc smoke flow tương ứng.

## Current delivery

Các mục này thuộc đợt triển khai hiện tại, không lặp lại trong backlog chưa làm:

- [x] **Native model variants** — model/variant lưu bằng `{ providerID, id, variant? }` theo session, nguồn là profile config cục bộ (`DEFAULT_CONFIG`), không phải `GET /api/model`: runtime đó còn quảng cáo cả các provider `opencode` built-in mà sản phẩm này không hỗ trợ, nên bị bỏ qua có chủ đích (`renderer.js`, `modelOptions`). Đổi variant không sửa profile hoặc restart runtime.
- [x] **Manual compaction lifecycle** — manual trigger, admission/coalescing, trạng thái queued/running/ended/failed và refresh sau khi hoàn tất.
- [x] **Undo / Revert / Redo** — user-message boundary, staged file restore, confirmation cảnh báo, Redo/Keep revert và hydrate từ `Session.Info.revert`.
- [x] **Prompt queue và steering** — Queue là hành động mặc định khi session đang chạy, Steer là lựa chọn tường minh; trạng thái hydrate từ pending list cùng admission/promotion events, retry giữ nguyên `inputId`. Bản core đang pin chỉ hỗ trợ interrupt execution hiện tại, chưa có API hủy riêng một pending item nên queued inputs vẫn chạy FIFO sau interrupt.
- [x] **VCS Changes panel** — tab `Changes` cạnh `Files` trong right sidebar: added/modified/deleted của worktree đang active qua `/api/vcs/status` + `/api/vcs/diff` (lazy per-file), patch cắt ở main (200 KB/patch, 2000 file). Hai sai lệch so với đặc tả gốc: `filesystem.changed` không bắn trên runtime đang pin (thiếu native watcher backend) nên auto-refresh chạy bằng `session.idle`/focus/branch-switch; và gate là `resolveProjectContext` chứ không phải artifact/file gate, vì patch đến từ API chứ không đọc đĩa. Chi tiết: [`../features/vcs-changes-panel.md`](../features/vcs-changes-panel.md).
- [x] **Context meter recovery after compaction** — `GET /api/session/{id}/context` được gọi một lần ngay sau `session.compaction.ended` để lấp khoảng trống giữa lúc compact xong và lượt trả lời kế tiếp. Trước đó ring bị khoá vĩnh viễn ở trạng thái "Pending" vì không có gì reset `compactionStatuses[sessionId]` khỏi `"ended"`; cơ chế `freshAfter` (snapshot số message tại thời điểm compaction kết thúc) cho phép ring tự phục hồi về số liệu thật của thread ngay khi một lượt trả lời mới thật sự xuất hiện, đồng thời không hiển thị nhầm số token pre-compaction của tin nhắn cũ như đang là hiện tại.
- [x] **File search picker** — ô tìm kiếm trong tab Files, debounce 200ms, dùng `GET /api/fs/find` (theo đúng luật scope/ignore phía server) thay vì duyệt cây thủ công. `fs/list` và `fs/read` được nối kèm nhưng cố tình chưa thay `files:list`/`files:read` hiện có — hai API đó vẫn là nguồn chính cho cây file và preview vì có sẵn realpath gate ở main process.

## P1 — Next

### [x] References

- **Priority:** P1
- **Dependency:** `/api/reference` và `reference.updated`; cần map reference local/Git vào project/worktree hiện tại.
- **Risk:** Reference path vượt project boundary hoặc nguồn Git stale có thể đưa context sai vào agent.
- **Acceptance signal:** List/add/remove reference qua main/preload; renderer không gọi URL trực tiếp; local path qua realpath gate; event refresh đúng project; reference bị thiếu hiển thị trạng thái có thể sửa. Đã kiểm chứng: `ReferencesPanel.svelte`, `reference-path.js`, `e2e/references-ux.spec.js`. `GET /api/reference` vẫn trả `data: []` trên runtime đang pin (xem caveat trong `runtime-contract.js`) nên config cục bộ là nguồn chính; server entries chỉ merge thêm cho tên chưa biết.

### [ ] Permission Center (đã làm một phần — xem bên dưới)

- **Priority:** P1
- **Dependency:** Permission events hiện có, cộng read model cho pending/history nếu core cung cấp.
- **Risk:** Quyết định “always allow” quá rộng hoặc áp nhầm session/resource là thay đổi bảo mật.
- **Acceptance signal:** Một màn hình tổng hợp pending permission theo session/project; scope và resource hiển thị rõ; approve/reject đồng bộ với in-thread card; không log secret/input nhạy cảm.
- **Đã làm một phần:** màn "Saved permissions" (Extensions tab) đọc/xoá qua `GET /api/permission/saved` + `DELETE /api/permission/saved/{id}` — quản lý các quyết định "Allow always" đã lưu. Danh sách **chưa lọc theo project**: app chưa có registry `projectID` phía server (không có lệnh gọi `/api/project` nào), nên mỗi dòng tự hiển thị `projectId` trả về thay vì lọc theo project đang mở. **Còn thiếu:** tổng hợp *pending* permission theo session/project (phần in-thread approve/reject vẫn là cơ chế cũ, độc lập với màn này).

### [x] Native attachment UX

- **Priority:** P1
- **Dependency:** V2 file input `{ uri, name, description }`, attachment capabilities theo model catalog và attachment registry hiện tại.
- **Risk:** Model không hỗ trợ modality, URI hết hạn, hoặc tự khôi phục external attachment sau revert.
- **Acceptance signal:** Capability-aware picker/chip; lỗi modality trước khi gửi; external attachment sau Undo yêu cầu attach lại; project-file reference và binary attachment được phân biệt rõ. Đã kiểm chứng: `attachment-capabilities.js`, `external-attachment-validation.js`, `e2e/attachment-ux.spec.js`, `e2e/fake-opencode-v2-attachments.js`.

## P2 — Later

### [x] Subagent run tree

- **Priority:** P2
- **Dependency:** Đã khóa bằng contract cho `parentID`, explicit `fork`, metadata tool `subagent`, active-session snapshot và durable `session.execution.*` log.
- **Risk:** Cây lớn hoặc event đến lệch thứ tự làm sai trạng thái parent/child.
- **Acceptance signal:** Đã kiểm chứng card cây đệ quy với running/succeeded/failed; non-fork child không xuất hiện trùng trong sidebar còn user fork vẫn hiện; reconnect rehydrate hierarchy và terminal state từ session family + durable log. Tracker giới hạn breadth-first 100 node, giữ stable ordering và bỏ stale `seq`.

### [x] Structured Forms

- **Priority:** P2
- **Dependency:** `form.created`, `form.replied`, `form.cancelled` và schema field/control ổn định.
- **Risk:** Renderer tự suy diễn schema có thể gửi dữ liệu sai kiểu hoặc bỏ validation server.
- **Acceptance signal:** Form render từ schema allowlisted; validation client chỉ hỗ trợ UX, server vẫn là authority; submit/cancel idempotent và per-session. Đã kiểm chứng bằng contract/projection tests, pending-form reconciliation và flow form chọn provider của `websearch`; tool lifecycle dùng `data.id` của v2 để giữ một row xuyên `input.started → called → success/failed`.

### [x] PTY terminal

- **Priority:** P2
- **Dependency:** PTY ticket/connect lifecycle, shell events và một terminal renderer phù hợp CSP.
- **Risk:** Đây là capability thực thi lệnh; cần permission, process cleanup, output limit và không được lộ token/env.
- **Acceptance signal:** Terminal chỉ hoạt động trong project được main xác thực; close app/session dọn process; reconnect có trạng thái rõ; command/output nhạy cảm không vào diagnostics. Đã kiểm chứng: `TerminalPanel.svelte`, `TerminalSurface.svelte`, `TerminalOpenConfirmModal.svelte`, `e2e/pty-ux.spec.js`. `POST /api/pty/{id}/connect-token` (luồng ticket chính thức) trả 403 mọi biến thể trên runtime đang pin — WebSocket handshake dùng lại Basic-auth header thay vì ticket (xem caveat `ptyConnect` trong `runtime-contract.js`).

### [ ] Managed background shell

- **Priority:** P2
- **Dependency:** `/api/shell`, `/api/shell/{id}`, `/api/shell/{id}/output`, `PATCH /api/shell/{id}/timeout`, `POST /api/session/{id}/background`. Khác PTY: đây là tiến trình nền có quản lý (stream theo cursor, gia hạn timeout), không phải terminal tương tác.
- **Risk:** Cùng lớp rủi ro với PTY (thực thi lệnh) cộng nguy cơ tiến trình nền không được dọn khi session/app đóng nếu vòng đời không khớp với PTY.
- **Acceptance signal:** Chạy lệnh nền (vd. build/test) có output streaming vào panel riêng, không chiếm Terminal tab; timeout gia hạn được; process dọn sạch khi session/app đóng.

### [ ] Session warming

- **Priority:** P2
- **Dependency:** Xác định chính xác runtime effect và resource cost của warm/active session API.
- **Risk:** Warm quá nhiều session làm tăng CPU/RAM hoặc giữ tool/MCP process ngoài ý muốn.
- **Acceptance signal:** Có budget và eviction rõ; đo cold-start cải thiện; không đổi active session; stop/project switch giải phóng toàn bộ tài nguyên đã warm.

## Deferred

### [ ] Session sharing

- **Priority:** Deferred
- **Dependency:** Quyết định sản phẩm thay đổi local-first policy, threat model và consent UX.
- **Risk:** Nội dung chat, file context hoặc metadata project bị gửi ra dịch vụ ngoài máy.
- **Acceptance signal:** Chỉ mở lại khi có privacy review, explicit opt-in, data inventory, revoke flow và audit trail.

### [ ] Plugin API

- **Priority:** Deferred
- **Dependency:** Upstream plugin API/versioning ổn định và có compatibility policy.
- **Risk:** Beta API thay đổi có thể phá startup/profile hoặc mở rộng capability ngoài permission model.
- **Acceptance signal:** Core công bố contract ổn định; plugin sandbox/permission được threat-model; có compatibility test trên phiên bản runtime pin.

### [ ] Formatter / LSP

- **Priority:** Deferred
- **Dependency:** Chứng minh endpoint/config tạo runtime effect quan sát được trong `opencode serve`.
- **Risk:** Xây UI cho config không có hiệu lực, hoặc chạy formatter/LSP ngoài project boundary.
- **Acceptance signal:** Probe end-to-end chứng minh effect; lifecycle/process ownership rõ; file mutation đi qua permission và worktree boundary.

## Backlog guardrails

- Giữ profile ở định dạng v1-compatible cho tới khi một capability bắt buộc schema v2 và có migration/rollback rõ ràng.
- Mọi API mới đi qua main/preload, validate input tại main và project payload trước khi qua IPC.
- Ưu tiên event-driven state; reconnect/reload phải hydrate từ server state thay vì chỉ tin state renderer.
- Với capability gây side effect, unit contract test là chưa đủ: phải có failure/race test và Electron smoke flow.
