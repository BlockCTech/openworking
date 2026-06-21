# Attachments, Office Context & Artifact Path (as-built)

> **Loại tài liệu:** As-built reference cho `src/attachment-registry.js`, `src/office-attachment-context.js`, `src/artifact-path.js` (+ test cùng tên).

## Context

Ba module hỗ trợ luồng "đính kèm file vào prompt", "trích nội dung file Office cho model", và "mở/preview artifact + duyệt file project an toàn". Điểm chung: chúng là nơi file cục bộ của người dùng đi vào (hoặc ra khỏi) app, nên đều có ranh giới bảo mật rõ ràng.

## 1. Attachment registry — `src/attachment-registry.js`

Map hai chiều `id ↔ filePath` trong memory cho file người dùng đính kèm.

- `add(filePaths)` / `addResolved(...)`: resolve path tuyệt đối, tạo `id` (UUID), đoán `mime` (`mime-types`), dedupe theo path. Trả về **chỉ** shape công khai qua `publicAttachment` → `{ id, filename, mime }`. **Đường dẫn tuyệt đối không bao giờ qua IPC.**
- `resolve(ids)`: đổi id → `{ type: "file", url: file://…, filename, mime }` để gắn vào prompt gửi OpenCode. Id không còn → throw "Attachment is no longer available."
- `discard(ids)` / `clear()`: dọn entry (gọi khi gỡ chip hoặc đóng cửa sổ).

IPC: `attachments:pick` (native picker), `attachments:addProjectFile` (file trong project, qua file-mention), `attachments:discard`.

## 2. Office attachment context — `src/office-attachment-context.js`

Trích **text có giới hạn** từ XLSX/PPTX để đưa vào ngữ cảnh model (không gửi file nhị phân). Parse XML trực tiếp bằng `adm-zip` (không phụ thuộc thư viện nặng).

- `officeAttachmentContext({ filePath, filename, mime })`: route theo mime/đuôi → `extractXlsxContext` / `extractPptxContext`. Lỗi → trả block "Extraction failed: …" thay vì throw.
- **XLSX**: parse sharedStrings + sheets + cells (kể cả formula), render thành bảng Markdown.
- **PPTX**: gom text từ slide + speaker notes.

Giới hạn (hằng số export, kiểm bằng `test/office-attachment-context.test.js`):

| Hằng số | Giá trị | Ý nghĩa |
|---|---|---|
| `MAX_ITEMS` | 20 | tối đa số sheet/slide |
| `MAX_ROWS` | 200 | tối đa dòng/sheet |
| `MAX_COLUMNS` | 50 | tối đa cột/sheet |
| `MAX_ITEM_CHARS` | 30000 | tối đa ký tự/khối (1 sheet/slide) |
| `MAX_FILE_CHARS` | 120000 | tối đa ký tự/cả file |

Vượt giới hạn → chèn marker `[Truncated: …]` và dừng — đảm bảo ngữ cảnh không phình.

## 3. Artifact path & project file access — `src/artifact-path.js`

Tập các "assert" gác cổng filesystem cho IPC `artifacts:*` và `files:*`. Tất cả dùng `fs.realpathSync` để chống symlink/`..` escape.

- **`assertTranslationArtifact(projectPath, artifactPath)`** — gate `artifacts:open` (→ `shell.openPath`). Cho phép khi: file tồn tại, đuôi ∈ `TRANSLATION_ARTIFACT_EXTENSIONS` (`.docx .md .markdown .pdf .pptx .xlsx`), **và** (tên khớp pattern `*-translated-<lang>` — new-file mode, ở đâu cũng được) **hoặc** (resolve nằm trong project root — in-place mode giữ tên gốc). Ngoài ra → throw.
- **`previewTranslationArtifact(...)`** — gate `artifacts:preview`; markdown → trả content (cắt theo `maxBytes`, mặc định 2 MiB), pdf → `file://` url, còn lại → `external`.
- **`assertProjectFile` / `assertProjectDirectory` / `listProjectDirectory`** — gate `files:read`/`files:list` (file-mention + duyệt project). Confine trong project root; chỉ mở file "viewable" (`VIEWABLE_FILE_EXTENSIONS` + basenames như `Dockerfile`); bỏ qua thư mục build/`node_modules`/`.git`…; tôn trọng `.gitignore` qua `git check-ignore` ở mode `visible-openable-files`.
- **`readProjectFileContent`** — đọc UTF-8 cắt theo `maxBytes` mà không vỡ ký tự multibyte ở biên (dùng `StringDecoder`).

## Cross-cutting / Security
- Đường dẫn tuyệt đối của attachment **không** rời main process (chỉ id/filename/mime qua IPC).
- Mọi truy cập filesystem từ renderer đều qua một "assert" realpath-confined; đây là ranh giới phải **giữ nguyên, không nới** (xem `01-architecture/architecture-overview.md` §7).
- Ngữ cảnh Office bị chặn kích thước cứng trước khi tới model.

## Tham chiếu
- Code: `src/attachment-registry.js`, `src/office-attachment-context.js`, `src/artifact-path.js`.
- IPC wiring + `shell.openPath` gate: `src/main.js` (`artifacts:*`, `files:*`, `attachments:*`).
- XLSX translation modes (liên quan artifact dịch): [[xlsx-translation-replace-only]] · [`built-in-skills.md`](./built-in-skills.md).
