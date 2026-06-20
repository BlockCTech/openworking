# Version Check & In-App Update (as-built)

> **Loại tài liệu:** As-built reference cho `src/version-check.js` (+ `test/version-check.test.js`).
> **Liên quan:** version API tự host, bật bằng `OPENWORKING_VERSION_API_BASE`.

## Context

Version check bị tắt mặc định. Khi `OPENWORKING_VERSION_API_BASE` được cấu hình, desktop hỏi version-check API xem build hiện tại còn được hỗ trợ không, rồi (tùy cấu hình server) hiển thị **soft update** (gợi ý) hoặc **force update** (bắt buộc). Module này cũng tải và tự cài bản `.dmg` mới (macOS). `package.json` `version` là single source of truth (`app.getVersion()` → `current_version`).

## Design

### `checkDesktopVersion({ currentVersion, platform, baseURL, arch })`
- Map `platform` → query param: `darwin→macos`, `win32→windows`, `linux→linux`; platform khác → `{ status: "ok", reason: "unsupported-platform" }`.
- Nếu không có `baseURL`/`OPENWORKING_VERSION_API_BASE`, trả `{ status: "ok", reason: "disabled" }`.
- Gọi `GET <base>/api/v1/desktop-app/version?platform=…&current_version=…`. Timeout `REQUEST_TIMEOUT_MS = 5s`.
- **Fail-open** (không khoá người dùng): lỗi mạng/timeout → `reason: "error"`; `404` → `not-configured`; non-2xx/empty body → `error`. Tất cả vẫn là `status: "ok"`.
- Chọn URL tải theo arch: `x64` (kể cả Rosetta) ưu tiên `download_url_intel`, fallback `download_url`; arm64 dùng `download_url`.
- Kết quả: `{ status: "force" | "soft" | "ok", latestVersion, downloadUrl, releaseNotes }`. Server sở hữu mọi so sánh semver — client chỉ đọc cờ `update_required` (force) / `update_available` (soft).

### `downloadInstaller({ downloadUrl, destDir, onProgress, maxRedirects = 5 })`
- **Chỉ chấp nhận https** (non-https → reject). Theo redirect tối đa 5 lần. Báo `% qua `onProgress`. Trả path file đã ghi.

### `installDmg({ dmgPath, appBundlePath })` — macOS-only
- `hdiutil attach -nobrowse -noautoopen -mountrandom /tmp` → tìm mount point (`parseMountPoint`) → tìm `.app` trong image → `ditto <sourceApp> <appBundlePath>` (giữ quyền/symlink/chữ ký, ghi đè bản đang chạy) → `hdiutil detach` (best-effort) → xoá `.dmg`. Mọi bước lỗi → throw để caller fallback sang mở `.dmg` thủ công.

### IPC + push channels (`src/main.js`, `src/preload.js`)
- `version:check`, `version:downloadAndInstall` (invoke).
- Push: `version:gate` (soft/force gate), `version:download-progress` (%), `version:install-status` (`downloading`/`installing`/`relaunching`).

## Cross-cutting / Security
- Fail-open trên version check (không bao giờ khoá người dùng vì lỗi mạng), nhưng force-update gate vẫn do server điều khiển.
- Download chỉ https; auto-install chỉ macOS; `exec`/`fileSystem` injectable để test không spawn process thật.

## Tham chiếu
- Code: `src/version-check.js` · wiring/push: `src/main.js`.
- Quy trình bump version + build/release: [`../../README.md`](../../README.md) mục "Releasing / Bumping Version".
