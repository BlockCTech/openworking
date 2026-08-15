# VCS Changes Panel (as-built)

> **Loại tài liệu:** As-built reference cho tab `Changes` trong right sidebar — `vcs:*` IPC, `RuntimeProcessManager.vcsStatus/vcsDiff`, `src/renderer/svelte/ChangesPanel.svelte`.
> **Backlog:** [`../05-operations/opencode-v2-feature-backlog.md`](../05-operations/opencode-v2-feature-backlog.md) — mục "VCS Changes panel" (P1, đã đóng).

## Context

Trước tính năng này, người dùng không có cách nào nhìn thấy toàn cảnh "working copy đang có gì thay đổi". Diff chỉ xuất hiện rải rác trong từng message của thread (`collectMessageDiffs`, `src/renderer.js`), nên thay đổi do người dùng tự sửa, do lệnh shell, hoặc từ session trước đều vô hình. Không có gì phản ánh trạng thái git thực tế của worktree đang active.

Panel `Changes` giải quyết đúng khoảng trống đó: liệt kê added/modified/deleted của **worktree đang active**, và mở diff từng file qua DocumentViewer sẵn có.

**Không nằm trong phạm vi:** stage/unstage, commit, discard changes, hay bất kỳ mutation git nào. Panel chỉ đọc.

## 1. Vị trí trong UI

Tab thứ hai cạnh `Files` trong right sidebar sẵn có, **không** phải panel thứ ba.

Lý do: `.app` là CSS grid với các cột right-anchored (`grid-column: -2 / -3`, xem `src/styles.css`), thêm một track nữa sẽ phải sửa cả stacked mode. Dùng lại panel hiện có thì thừa hưởng luôn resizer, width persistence và transition đóng/mở.

- `state.rightSidebarTab` (`"files" | "changes"`) quyết định thân panel; cả hai tab dùng chung header/resizer.
- `ChangesPanel.svelte` là con của `RightFileSidebar.svelte`, nên không cần đăng ký island riêng.

## 2. Nguồn dữ liệu — `/api/vcs/*`

Runtime đang pin (`@opencode-ai/cli@0.0.0-next-16985`) đã có sẵn hai endpoint, nên **không** cần shell ra `git` CLI:

| Endpoint | Trả về |
|---|---|
| `GET /api/vcs/status?location[directory]=<dir>` | `{ location, data: [{ file, status: "added"\|"deleted"\|"modified", additions, deletions }] }` |
| `GET /api/vcs/diff?location[directory]=<dir>&mode=working` | `{ location, data: [{ file, patch, additions, deletions, status }] }` |

Cả hai được khai báo trong `V2_ENDPOINTS` (`src/runtime/runtime-contract.js`) và gọi qua `requestJson` + `this.auth()` như mọi endpoint khác.

**File untracked được báo `status: "added"`** — đã kiểm chứng trên server thật, không cần xử lý riêng.

### ⚠️ Cạm bẫy encoding: `location[directory]`, không phải `directory`

Hai endpoint này nhận directory dạng OpenAPI **`deepObject`** (`location[directory]`), khác với `sessionsByDirectory` vốn dùng `directory` phẳng.

Kiểm chứng trên server thật với hai repo riêng biệt:

| Dạng gửi | Kết quả |
|---|---|
| `?location%5Bdirectory%5D=/repo2` | ✅ trả file của `repo2` |
| `?directory=/repo2` | ❌ **HTTP 200** kèm file của cwd server (`repo1`) |

Dạng phẳng **không báo lỗi** — nó chỉ âm thầm trả sai thư mục. Nếu copy pattern của `sessionsByDirectory` thì panel sẽ hiện file của worktree khác mà không có dấu hiệu nào để nhận ra, tức là đúng lỗi "trộn main worktree với active worktree" mà backlog cảnh báo. Vì vậy dấu ngoặc được encode cứng trong `V2_ENDPOINTS` kèm comment, và `test/runtime-contract.test.js` assert rằng URL **không** chứa `directory=` phẳng.

`mode` cũng là bắt buộc: thiếu nó server trả HTTP 400.

## 3. Lazy diff per-file

Panel chỉ tải `/api/vcs/status` (nhẹ, không có `patch`). Patch chỉ được fetch khi người dùng bấm vào một hàng — `openVcsDiff(file)` gọi `vcs:diff` rồi đưa kết quả vào `openDocument(file, { diff, tab: "diff" })`.

Toàn bộ phần render diff **tái sử dụng**, không viết mới: `parseUnifiedDiff` (`src/diff-view.js`) → `renderUnifiedDiff` (`src/renderer/markup.js`) → `DocumentViewer.svelte`. Patch trả về là unified diff chuẩn có header `diff --git`, đúng dạng `parseUnifiedDiff` đã bỏ qua sẵn.

**File bị xoá** đi đường riêng: `openDocument` sẽ cố `files.read` và thất bại (file không còn trên đĩa), nên `openVcsDiff` phát hiện `status === "deleted"` và gọi thẳng `showDocument` với patch, bỏ qua bước đọc file.

## 4. Auto-refresh — vì sao KHÔNG dùng `filesystem.changed`

Backlog đặt `filesystem.changed` làm dependency, nhưng event này **không bao giờ bắn** trên runtime đang pin.

Nguyên nhân (đọc từ sourcemap của binary): `core/src/filesystem/watcher.ts` resolve watcher backend qua

```
process.env.OPENCODE_PARCEL_WATCHER_PATH ?? "@parcel/watcher-<platform>-<arch>"
```

mà `@parcel/watcher` **không** phải dependency — kể cả optional hay transitive — của `@opencode-ai/cli@0.0.0-next-16985`. Không tìm thấy binding thì `subscribeDirectory` log `"watcher backend not supported"` rồi no-op.

Probe end-to-end trên `next-16365` cho thấy tạo/sửa/xoá file thật (kể cả khi đã có session đăng ký với đúng directory) không sinh ra event nào, trong khi `catalog.updated` vẫn về bình thường — tức là SSE pipeline vẫn sống, chỉ riêng watcher là chết. Dependency audit trên bản pin hiện tại `next-16985` vẫn không có watcher binding.

### Các trigger đang dùng thay thế

`scheduleVcsRefresh()` (debounce 300 ms) được gọi từ:

| Trigger | Bắt được tình huống |
|---|---|
| `session.idle` | Agent vừa kết thúc lượt → file trên đĩa vừa bị sửa. Đây là trigger chính. |
| `window` `focus` | Người dùng sửa file ngoài app (IDE, terminal, build). |
| Checkout branch / switch worktree | Working copy chuyển sang directory hoặc HEAD khác. |
| Nút Refresh trong panel | Thoát hiểm thủ công. |
| `filesystem.changed` | Hiện không bắn; giữ để tự lên realtime nếu runtime sau ship watcher backend. |

Debounce là cần thiết vì một lượt agent chạm nhiều file, và `focus` có thể trùng với `session.idle`.

`scheduleVcsRefresh()` **no-op** nếu panel đóng hoặc đang ở tab `Files`, nên các trigger này không tốn gì khi người dùng không xem panel.

## 5. Cross-cutting / Security

**Boundary.** `vcs:status` và `vcs:diff` đi qua `resolveProjectContext({ projectId, directory })` (`src/main.js`) → `resolveRegisteredProjectDirectory` → `effectiveProjectPath`. Renderer không thể ép một directory nằm ngoài project/worktree đã đăng ký.

Khác với `files:*`/`artifacts:*`, ở đây **không có gate realpath phía sau** — và không cần: dữ liệu trả về đến từ runtime API chứ không phải đọc đĩa, nên không có `shell.openPath` hay file read nào để bảo vệ. Boundary duy nhất là chọn đúng directory.

Vì runtime chạy với cwd = `effectiveProjectPath(project)`, project đang ở worktree đã switch sẽ tự động báo cáo đúng worktree đó. `test/project-context.test.js` khoá hành vi này lại.

**Giới hạn payload (cắt ở main, không phải renderer).**

| Hằng số | Giá trị | Bảo vệ khỏi |
|---|---|---|
| `MAX_VCS_PATCH_LENGTH` | 200 000 ký tự (= `MAX_DIFF_LENGTH`) | Renderer highlight từng dòng diff; một patch không giới hạn (lockfile, vendored dump) sẽ chặn main thread của nó. |
| `MAX_VCS_STATUS_FILES` | 2000 file | Cây vừa clone hoặc generate hàng loạt có thể báo hàng chục nghìn file. |

Cả hai trả kèm cờ `truncated` để UI hiển thị banner thay vì im lặng cắt bớt.

**Allowlist.** `projectVcsFileStatus` chỉ giữ `{ file, status, additions, deletions }`; field lạ bị bỏ, số âm/null bị clamp về 0, entry không có `file` bị loại. Event `filesystem.changed` / `vcs.branch.updated` cũng chỉ chiếu field trong allowlist — nội dung file không bao giờ qua IPC.

## 6. Delegation (bẫy đã gặp)

Right-sidebar island **không** mount với `delegate: true`, nên component bên trong phải tự dispatch click qua `ctx.actions.click(attr, e)` — giống `FileTreeNode.svelte` làm. Nút thiếu `onclick` sẽ render bình thường nhưng **hoàn toàn không phản ứng**.

Unit test gọi thẳng hàm không phát hiện được lỗi này; chỉ click qua DOM thật mới bắt được. `test/renderer.test.js` có một test dành riêng cho việc đó ("clicking the Changes tab and a file row dispatches through the delegated tables").

## 7. File liên quan

| File | Vai trò |
|---|---|
| `src/runtime/runtime-contract.js` | `vcsStatus`/`vcsDiff` endpoint + `filesystemChanged`/`vcsBranchUpdated` event name |
| `src/runtime/process-manager.js` | `vcsStatus()`, `vcsDiff()`, `projectVcsFileStatus`, caps, projection event |
| `src/main.js` | IPC `vcs:status`, `vcs:diff` (cạnh nhóm `git:*`) |
| `src/preload.js` | `window.openworking.vcs.{status,diff}` |
| `src/renderer.js` | State `vcs*`, `loadVcsStatus`, `scheduleVcsRefresh`, `openVcsDiff`, `selectRightSidebarTab` |
| `src/renderer/svelte/ChangesPanel.svelte` | Danh sách file, badge A/M/D, tổng +/−, empty/error/truncated state |
| `src/renderer/svelte/RightFileSidebar.svelte` | Segmented control `Files` / `Changes` |
| `src/styles.css` | `.right-file-seg`, `.vcs-*` |

## 8. Test

| Test | Bao phủ |
|---|---|
| `test/runtime-contract.test.js` | URL encode `location[directory]`, `mode` bắt buộc, không có `directory=` phẳng |
| `test/runtime-process-manager-v2.test.js` | Projection `filesystem.changed` / `vcs.branch.updated`, drop field ngoài allowlist |
| `test/runtime-process-manager.test.js` | Cắt patch 200 KB và list 2000 file (+ cờ `truncated`), directory yêu cầu đúng, no-op khi thiếu tham số |
| `test/project-context.test.js` | Project có worktree resolve về worktree, không phải main checkout |
| `test/renderer.test.js` | Render list/empty/error, debounce, guard đổi project, mở diff, file deleted, click qua DOM |
| `e2e/vcs-changes.spec.js` | Electron thật + runtime thật: 3 status hiển thị đúng badge, click mở diff thật |

E2E này override `OPENWORKING_RUNTIME_BIN` bằng binary thật (các spec khác trỏ `/does/not/exist`), vì panel đọc dữ liệu từ runtime — stub thì chỉ chứng minh được empty state.

## References

- Backlog: [`../05-operations/opencode-v2-feature-backlog.md`](../05-operations/opencode-v2-feature-backlog.md)
- Kiến trúc + IPC surface: [`../01-architecture/architecture-overview.md`](../01-architecture/architecture-overview.md)
- Worktree boundary (`git:*`, `activeWorktreePath`): [`worktree-branch-selector.md`](worktree-branch-selector.md)
- Evidence OpenAPI: `.agents/evidence/v2-openapi-0.0.0-next-16350.json`
