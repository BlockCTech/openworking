# Changelog

## [v1.12.0] - 2026-06-21

### Nguồn so sánh

- Base: `v1.11.1` (`cf12faf`, merge `develop` vào `master`, 2026-06-19).
- Target: `master` hiện tại (`cfdd26e`, merge `develop`, 2026-06-21) cộng version bump trong working tree từ `1.11.2` lên `1.12.0`.
- Ghi chú: tại thời điểm tạo changelog, local git có tag `v1.11.1` nhưng chưa có tag `v1.12.0`.

### Added

- Thêm cross-chat memory:
  - Bundle skill `cross-chat-memory` và tool runtime `remember.js`.
  - Lưu memory global và theo project dưới app-managed OpenCode profile.
  - Tự gắn memory theo project vào `instructions` khi mở project.
  - Thêm UI Memory trong màn Skills để đọc/sửa global memory và project memory.
- Thêm pin chat session và project:
  - Chat pin lưu local trong `pinned-sessions.json` với metadata project/title/update time.
  - Project pin lưu trên project registry.
  - Sidebar có khu vực `Pinned` để gom chat/project đã ghim lên đầu.
- Thêm khả năng xem history chat theo từng project từ sidebar:
  - Runtime hỗ trợ lấy session/message theo `directory`.
  - Renderer có thể hiển thị lịch sử session của project khác mà không cần spawn runtime riêng.
- Thêm Backlog MCP preset dạng local stdio server (`npx backlog-mcp-server`) với env `BACKLOG_DOMAIN` và `BACKLOG_API_KEY`.
- Thêm hỗ trợ env vars cho local MCP server và hiển thị chi tiết metadata khi runtime yêu cầu permission.
- Thêm log diagnostics cho prompt, command và tool lifecycle trong runtime.

### Changed

- Nâng `opencode-ai` từ `1.17.8` lên `1.17.9`.
- Bump package version lên `1.12.0`.
- Giảm kích thước app/package khoảng 61 MB (~15%) bằng cách:
  - Loại `.map`, `.d.ts`, `.ts`, thư mục test/example khỏi bundle.
  - Chỉ giữ phần Mermaid runtime cần thiết.
  - Loại các dependency transitively chỉ phục vụ Mermaid khỏi packaged app.
- Cập nhật MCP/Extensions UI và docs:
  - Skills screen có tab Extensions/MCP rõ hơn.
  - Runtime chạy với `--print-logs` để surface lỗi MCP/OAuth dễ đọc hơn trong Diagnostics.
  - MCP auth có reset auth cho trạng thái OAuth lỗi/stale.
- Runtime bổ sung `waitUntilReady()` để các read operation đợi vòng restart hoàn tất thay vì fail ngay.
- Packaged runtime được spawn với PATH thật của user để local MCP server như `npx ...` resolve được trong macOS packaged app.

### Fixed

- Sửa luồng thread rehydration khi session đang stream:
  - Theo dõi `lastStreamEventAt`, `lastEventAt`, `lastAssistantOutputAt`.
  - Tránh rehydrate quá sớm khi assistant đang output/tool đang chạy/pending question hoặc permission.
  - Rehydrate lại khi stream bận đã stale.
- Sửa hiển thị/history session:
  - `runtime:listSessions`, `runtime:listSessionsForDirectory`, `runtime:listCommands` trả `[]` khi runtime restart race thay vì ném lỗi handler ồn.
  - Message history có thể request theo directory đúng project.
- Sửa endpoint reply question/permission theo API mới của OpenCode.
- Sửa prompt failure UX:
  - Khôi phục draft và attachments khi runtime startup/send prompt lỗi.
  - Hiển thị toast lỗi kể cả trước khi optimistic user message được tạo.
- Sửa path handling cho artifact:
  - Normalize child relative path sang `/` trước khi gọi git check-ignore.
- Sửa document translation fallback:
  - Markdown chỉ có block không dịch được sẽ copy nguyên nội dung ra artifact.
- Harden profile permission config:
  - Lọc permission keys reserved.
  - Dùng `Object.hasOwn` khi set/remove tool permission do custom skill khai báo.
- Sửa local MCP profile editing để env vars round-trip đúng khi mở lại modal edit.
- Sửa runtime process/openProject flow:
  - `resolveUserPath` chạy async bằng `execFile`.
  - `openProject` đợi chuẩn trước khi gán PATH và phục vụ read calls.

### Removed

- Xóa các file chẩn đoán tạm trong `tmp-diagnostics/` khỏi source tree:
  - `gateway-500-diagnosis.md`
  - `gateway-500-payload.full.json`
  - `gateway-500-payload.redacted.json`

### Tests

- Thêm test mới cho:
  - `memory-store`
  - `pin-registry`
  - cross-project/session history behavior trong renderer
  - thread rehydration và stream stale handling
- Mở rộng test hiện có cho:
  - `renderer`
  - `runtime-process-manager`
  - `thread-stream`
  - `opencode-profile`
  - `project-registry`
  - `artifact-path`
  - `document-tools`

### Commit tham chiếu

- `d58c1db` Reduce app size -61 MB (~15%).
- `a6a8022` Update MCP for Backlog.
- `452d8f7` Memory chat built in skills.
- `e3d03f5` Improve runtime/project/artifact/profile/document/prompt error handling.
- `027fe40` Pinned chat feature.
- `435ed94` Show history project chat.
- `bb188f4` Fix issue of thread rehydration.
- `d7e299f` Fix issue of thread rehydration.
- `5329382` Fix `needsThreadRehydration` flow.
- `7b95010` Fix show history.
- `ec06113` Upgrade OpenCode core to `1.17.9`.
