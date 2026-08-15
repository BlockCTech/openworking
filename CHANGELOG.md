# Changelog

Mỗi release ghi ngắn gọn những thay đổi người dùng thấy được và các quyết định kỹ thuật đáng nhớ.
Chi tiết đầy đủ (diff, lý do từng dòng) nằm trong git history của file này và trong commit message.

## [v2.0.3] - 2026-08-05

Base `v2.0.2` (`1c693f0`) → `a1bd500` (pull request #133). Không đổi runtime hay frozen schema. Thêm hai IPC read-only (`runtime:listPendingPermissions` / `runtime:listPendingQuestions`); preload boundary vẫn chỉ mở rộng qua `window.openworking.runtime`.

### Fixed

- **Card permission/question không còn biến mất rồi treo tool**: `applyMessages` (`src/thread-stream.js`) trước đây xóa `pendingQuestions`/`pendingPermissions` mỗi khi `sessionId` đổi — nhưng renderer dùng chung một thread object cho mọi session nên đổi session là đường chạy bình thường, còn runtime thì vẫn đang chờ trả lời. Card bị drop khi hydrate ⇒ không ai trả lời được ⇒ tool treo "Processing" rồi fail. Giờ hydrate không xóa nữa; card chỉ được retire ở nơi turn thật sự kết thúc (`session.aborted`, `permission.replied`, `resetThread`).
- **Dọn card đã chết bằng cách hỏi lại runtime** (`reconcilePendingRequests`): OpenCode giữ pending request trong Map process-local không persist — mất khi runtime restart, khi abort session, và khi một permission anh em trong cùng session bị reject (đường interrupt **không** phát event nào), trong khi SSE stream lại không có replay cursor nên reconnect là mất luôn event phát lúc stream chết. Hai endpoint list mới đọc đúng cái Map mà endpoint reply tra cứu, chạy khi stream nối lại và khi runtime chuyển sang `running`. An toàn hai lớp: lookup lỗi (hoặc body 200 lạ, kể cả HTML fallback) trả `null` chứ không phải `[]` để không bao giờ evict nhầm trên một cú blip; và chỉ evict session thuộc project của runtime đang chạy, vì `state.threads` sống lâu hơn lần đổi project nên quét cả sang project khác sẽ xóa card đang sống của họ.
- **Hết lỗi thô `HTTP 404: {"_tag":"PermissionNotFoundError"…}` đập vào mặt người dùng**: request runtime đã quên giờ trả `{ ok: false, reason: "expired" }` như một giá trị thay vì throw (Electron `ipcRenderer.invoke` chỉ serialize `Error.message` và bọc thêm "Error invoking remote method …"), renderer xóa card và toast một câu tiếng Việt dễ hiểu. Lỗi thật (network, 5xx) vẫn throw và **giữ** card để người dùng thử lại.
- **Double-click không còn tạo 404 giả**: click thứ hai trước đây gửi lại đúng `requestID` mà runtime đã drop ở lần đầu. Thêm khóa in-flight theo `sessionId:requestID`; trong lúc chờ round-trip nút bị `disabled` thật kèm dòng "Sending…" thay vì để nút enabled rồi nuốt click im lặng (đọc như nút chết). Sweep eviction bỏ qua request đang bay vì runtime đã xóa nó khỏi pending map.

### Added

- **Bung chi tiết lỗi của tool ngay trong chat**: dòng tool fail trở thành `<button>` có `aria-expanded`, mở ra `Error` (message gốc của runtime, cắt ở 600 ký tự, wrap thay vì ellipsis) và `Fix` — một câu hành động được map từ các dạng lỗi có thật của edit tool (`multiple matches`, `could not find oldString`, `matched span is much larger`, `oldString cannot be empty`, `no changes to apply`, `ENOENT`, và phrasing của prompt duyệt quyền). Chỉ dòng fail mới focusable, tránh làm rối keyboard nav trong thread dài. `state.expandedToolErrors` key theo part id nên sống sót qua repaint lúc streaming, và được dọn theo thread (`forgetToolErrorExpansion` trong `pruneThreads`/`deleteSession`, clear khi xóa project/logout) vì part id có thể suy ra từ index nên id cũ có thể va vào part mới và mở nhầm dòng.
- Tách `src/error-hints.js` dùng chung main process ↔ renderer (UMD như `src/renderer/util.js`), để lỗi khởi động runtime và dòng tool sửa file fail nói cùng một câu hướng dẫn cấp quyền macOS.

### Changed

- Nhãn tool step giữ lại subtitle (tên file) cả khi lỗi — đó là thứ đầu tiên cần để xử lý; marker `[subagent]` đứng trước label nên bước fail của subagent không lẫn với bước của agent chính.

### Tests

Thêm `error-hints`. Mở rộng `renderer` (+265 dòng: expand/collapse dòng lỗi, map hint, in-flight lock và trạng thái disabled, `reconcilePendingRequests` với `null` vs `[]` và giới hạn scope theo project), `runtime-process-manager` (+172: 404 expired → `{ ok: false }`, payload lạ → `null`, list endpoint), `thread-stream` (+53: hydrate đổi session không xóa pending).

### Commit tham chiếu

`a1fffbc` Fix error Editing file failed ERROR · `d186c0a` / `7365bf6` Fix event permisson · `187afeb` (pull request #130) · `b2a2fff` (pull request #131) · `15fa52f` (pull request #132) · `a1bd500` (pull request #133).

## [v2.0.2] - 2026-08-02

Base `v2.0.1` (`4ae6e42`) → `1c693f0` (pull request #126). Không thêm IPC, không đổi preload boundary.

### Changed

- Re-sync frozen config schema theo opencode `1.18.11`: field `interleaved` của reasoning nới rộng (nhận `boolean` bất kỳ, nhận string tự do bên cạnh enum, `reasoning_details` → `reasoning_text`) để validator Ajv offline không reject config hợp lệ do runtime mới sinh ra.
- **Chọn chat nhanh hơn hẳn** — `selectSession` vẽ trước, fetch sau: `clearPendingAttachments()` chuyển sang chạy nền thay vì chắn trước lần paint đầu; set active state rồi `render()` ngay (chat đã cache hiện tức thì, chưa cache thì hiện loading); đường "runtime chưa sống" gọi thẳng `activateProjectRuntime` nên cold start chỉ còn một lần; refresh dùng `renderThreadContent` chỉ repaint thread.
- Hydrate tách khỏi "đang active" (`hydrateSessionThread(projectId, sessionId, …)`): response về muộn của chat cũ cập nhật cache của chính nó chứ không đè lên chat đang mở. Refresh lỗi mà thread đã có cache thì giữ nguyên nội dung, chỉ toast "Could not refresh chat."
- `loadSessionMessages` gửi `directory` của chính session (`session.directory` → `activeWorktreePath` → `project.path`) thay vì luôn dùng `project.path`, nên xem chat thuộc worktree khác không còn trả rỗng.
- **Bấm tên project chỉ đóng/mở accordion**, không khởi động runtime (`toggleProject` + `data-toggle-project`, có `aria-expanded`). Runtime chỉ start qua hành động thật sự cần: mở session, tạo session mới, mở project card, gửi prompt. Icon folder đổi theo trạng thái mở/đóng với màu trung tính; danh sách session có slide 160ms, về 0ms khi `prefers-reduced-motion`.
- **Dọn UI chat**: bỏ toàn bộ chỉ số thời gian/token trong thread (vòng context-window trên composer vẫn giữ vì đo context size); bỏ icon từng tool-step; `.message-actions` luôn hiện và nhỏ lại; sidebar bỏ badge đếm project/session; thêm dòng thương hiệu "OpenWorking"; "New session" đổi nhãn thành "New chat".
- `README.md` viết lại phần Windows: quy ước tên `OpenWorking-<version>-<arch>.exe`, bắt buộc build trên Windows host, phân biệt `dist:win:unsigned` với `release:win -- --no-bump` (ký, cần đủ 7 biến Azure Trusted Signing).

### Tests

Mở rộng `renderer` (vẽ cache trước rồi repaint riêng thread; hydration muộn không đè chat mới hơn; refresh lỗi vẫn giữ thread; session chưa cache cold-start đúng một lần; toggle project local-only; thread/tool row/sidebar không còn metadata và badge), `config` (các dạng `interleaved` mới) và E2E `navigation` (project folder là disclosure trung tính).

### Commit tham chiếu

`aae1aa7` upgrade opencode 1.18.11 · `573c7b6` Optimate performance · `db4db39` Fix ui display chat · `47cd76c` Fix README clear for build · `ad61645` (pull request #125) · `1c693f0` (pull request #126).

## [v2.0.1] - 2026-07-31

### Nguồn so sánh

- Base: `v1.14.0` (`1d573a3`, Update bump version 1.14.0, 2026-07-27).
- Target: `master`/HEAD tại `4ae6e42` (merge `develop` pull request #121, 2026-07-31), gồm version bump `package.json` (trên nhánh này là `2.0.1`).
- Ghi chú: chưa có tag `v2.0.1` trong git local; mốc phát hành xác định theo lần bump `package.json` (`58beaff`). Release này chỉ có UI/build/core — **không thêm IPC hay đổi preload boundary**; toàn bộ diff nằm trong `src/renderer*`, `src/styles.css`, `scripts/release.js`, `build/` và `package.json`.

### Changed

- Làm lại dark theme và dọn thiết kế ô nhập chat (`Change UI/UX for dark theme and clean design in chat input`):
  - Palette dark tối và tương phản hơn: `--bg` `#1a1a1b` → `#131314`, `--sidebar` `#161617` → `#202022`, `--surface` `#1f1f21` → `#1b1b1d`; thêm token mới `--sidebar-active` (dark `#313135`, light `#e4e4e9`) và dùng nó cho mọi trạng thái active trong sidebar (`.session-row-wrap.active`, `.nav-item.active`, `.file-tree-row.active`, `.side-user.active`, `.file-tree-row.active`) thay cho `--surface-2` — trước đây trạng thái active lẫn với nền panel.
  - `--scrollbar-thumb` chuyển từ màu đặc sang `rgba()` để thumb chồng lên nền nào cũng đọc được.
  - Composer sạch hơn: bỏ vòng focus ring `0 0 0 4px var(--accent-soft)` khi `:focus-within`, bỏ outline mặc định của nút trong `composer-bar` và chuyển sang `:focus-visible` (chỉ hiện khi điều hướng bằng bàn phím).
  - Divider resize không còn vẽ nền/đường kẻ riêng (`background: var(--bg)` → `transparent`) nên không tạo đường kẻ đôi cạnh viền panel.
- Thêm overlay scrollbar riêng cho sidebar (`src/renderer/side-scrollbar.js`, module UMD mới ~165 dòng, nạp qua `<script>` trong `index.html`, markup trong `Sidebar.svelte`):
  - Native scrollbar bị ẩn (`scrollbar-width: none`) trên toàn bộ `.side-scroll` (trước chỉ ẩn khi `.app.has-doc`) và thay bằng `<div>` tự vẽ — vì độ dài thumb native luôn là `viewport ÷ content`, không có CSS nào rút ngắn được khi danh sách session dài.
  - Thumb giữ tỉ lệ theo content nhưng có sàn `THUMB_MIN = 28px`; bar tự ẩn khi không cuộn được (`.empty`), hiện khi hover sidebar hoặc đang cuộn rồi fade sau `FADE_MS = 900ms`.
  - Damp con lăn chuột (`WHEEL_DAMPING = 0.45`) chỉ với wheel notch thật (delta ≥ `40px` hoặc `DOM_DELTA_LINE`); trackpad macOS (nhiều delta nhỏ + momentum của OS) đi qua nguyên vẹn để không phá inertia. Bỏ qua `ctrlKey` (pinch-zoom).
  - Kéo thumb và click track đều được; listener gắn trên `window` như `startRightFileSidebarResize` nên drag không đứt khi chuột rời khỏi bar 8px. `ResizeObserver` theo dõi scroller để thumb đúng khi project expand/collapse hay session stream về.
  - `.side-scroll` vẫn là overflow scroller thật nên wheel/keyboard paging và `captureSidebarScroll`/`restoreSidebarScroll` hiện có không đổi. `attach()` idempotent (cờ `__owSideScrollbarWired`), gọi từ `bindEvents()` sau mỗi render và bọc try/catch — scrollbar là trang trí, không được phép abort `bindEvents()`.
- Làm lại typography câu trả lời trong chat (`Fix UI chat`, thuần `styles.css`):
  - `.ai-body` giới hạn `max-width: 78ch` (~72–78 ký tự mỗi dòng). Đặt ở `.ai-body` chứ không phải `.assistant-text` vì DocumentViewer và SkillPreviewModal cũng mang class `.assistant-text` và đã tự giới hạn bề rộng.
  - Thêm thang heading h1–h6 (tỉ lệ ~1.18 trên nền 13.5px, nén lại vì chat không phải document), margin block, `strong` weight `650` (UA bold `700` sẽ đảo ngược thứ bậc so với heading), `blockquote`, `hr`, `img`, list marker và list lồng nhau — trước đó reset `*` toàn cục xóa sạch margin của `p`/`h1-h6`/`blockquote`/`hr` nên heading render đậm mà không có khoảng cách, `hr` render thành hộp 0px vô hình.
  - Edge reset đổi từ `p:last-child` sang `> :first-child` / `> :last-child` nên phủ luôn `ul`/`ol`/`pre`/`table`/`blockquote`/`hr`.
  - Fenced code: thêm `overflow-wrap: normal` để không kế thừa `overflow-wrap: anywhere` từ `.assistant-text` (đang làm dòng code dài xuống dòng giữa identifier thay vì scroll ngang); inline code bỏ border, `0.9em` → `0.875em` để khớp x-height với `-apple-system`. Thêm token `--mono` dùng chung.
  - Khối reasoning ("thinking") có override riêng bằng selector `(0,2,1)` (`.reasoning-text.assistant-text`) để giữ treatment mờ/nhỏ hơn bất kể thứ tự source; plan card hạ `h1`/`h2` xuống `1.06em` cho vừa preview cao 180px.

### Fixed

- Sửa **layout panel vỡ khi resize cửa sổ**: `maxRightFileSidebarWidth()` đo live thay vì clamp cứng nên panel Files không ép cột chat xuống dưới mức tối thiểu; guard mọi input là số hữu hạn (một track `NaNpx` là sập cả grid); resize handler giữ bề rộng hiện tại thay vì snap về `DOCUMENT_MAX_WIDTH`.
- Sửa **build ký/notarize macOS**: bật `hardenedRuntime` + `build/entitlements.mac.plist` (`allow-jit` cho V8, `disable-library-validation` vì runtime opencode là binary Bun nạp dylib chưa ký, `allow-dyld-environment-variables` vì `opencode serve` spawn kèm override env). `scripts/release.js` chấp nhận identity từ login keychain chứ không bắt buộc `CSC_LINK`, và chạy `xcrun notarytool history` **trước** khi build để fail sớm vài giây thay vì hỏng cả lần build hai kiến trúc ~20 phút.

### Tests

Mở rộng `renderer` (clamp resize theo viewport live, `documentViewerWidthForResize`) và `release` (keychain identity, `CSC_LINK` thiếu password, issuer không phải UUID).

### Commit tham chiếu

`cb52236` Fix panel layout breaking on window resize (pull request #110) · `a896c9f` fix build with key · `2de40a5` Change UI/UX for dark theme · `323958c` Fix UI chat · `4ae6e42` (pull request #121).

## [v1.14.0] - 2026-07-27

Base `v1.13.12` (`de5e202`) → `bc4fcef` (pull request #108). Nâng minor vì mở thêm target Windows.

### Added

- **Build/release Windows** (target đóng gói thứ hai sau macOS): NSIS per-user installer cho `x64`/`arm64` (`OpenWorking-<version>-<arch>.exe`), `scripts/before-pack.js` thành platform-aware, `scripts/windows-release.js` build + ký qua Azure Trusted Signing rồi verify chữ ký và sinh sidecar SHA-256. Smoke mới `smoke:packaged:win` (kiểm PE machine header) và `smoke:installer:win` (fresh install → silent upgrade → launch → uninstall, khẳng định `userData` sống sót nên session/profile không bị xóa). CI tách workflow test và workflow release (chỉ chạy theo version tag hoặc manual dispatch đã duyệt). Auto-update thêm `verifyWindowsInstaller` — installer không verify được thì **không bao giờ** được thực thi, app chuyển sang trạng thái `manual`.
- **Tham chiếu file/snippet vào chat bằng chuột phải**: menu "Add to chat" trên Files panel chèn token file-mention thẳng tại caret; bôi đen code trong tab Code rồi chuột phải chèn snippet dạng `path:N-M`. Dùng `oncontextmenu` thay vì floating button để tránh race với `selectionchange`.
- **Layout Files/Code xếp chồng** và in-file search cho document viewer: toggle side-by-side ↔ stacked, kích thước persist riêng trong localStorage. Search dùng CSS Custom Highlight API thay vì bọc `<mark>` — match có thể vắt qua `<span>` của highlight.js nên `Range.surroundContents()` sẽ throw. File markdown thêm cặp toggle Preview/Raw.

### Changed

- Nâng `opencode-ai` `1.18.3` → `1.18.7`; đồng bộ frozen schema thêm `subagent_depth`.
- Migrate **composer/prompt input sang Svelte** (`PromptEditor.svelte`, `PromptAssistMenu.svelte`, `AttachmentChips.svelte`); `src/renderer.js` giảm ~255 dòng, domain state/action vẫn ở renderer legacy, preload/IPC boundary không đổi.
- Bật minify cho bundle khi đóng gói (`BUILD_MINIFY=1`); dev/test/smoke vẫn build không minify để stack trace còn đọc được.
- Giới hạn tính năng chỉ-macOS một cách tường minh trên Windows (IDE launcher báo lỗi rõ, Browser Use trả `{ supported: false, reason }`) thay vì fail khó hiểu.

### Tests

Thêm `before-pack`, `windows-release`, `windows-installer-smoke`. Mở rộng `renderer` (+~2700 dòng: prompt editor/assist menu Svelte, context menu, snippet line-range, stacked layout, in-file search), `thread-stream`, `version-check`, `ide-launcher`, `config`.

### Commit tham chiếu

`61e794a` Migration prompt input to Svelte (pull request #103) · `5545ea5` Apply build Minify (pull request #104) · `937c2a8` File/snippet references + stacked layout (pull request #105) · `8f9e678` Build Windows version (pull request #106) · `ae7c561` Upgrade opencode 1.18.7 (pull request #107) · `bc4fcef` (pull request #108).

## Lịch sử rút gọn

Các release trước `v1.14.0`, gói lại mỗi bản một đoạn.

### [v1.13.12] - 2026-07-20

Migrate renderer sang kiến trúc hybrid **Svelte 5** (`build:renderer` bundle các island dưới `src/renderer/svelte/`; bỏ kill-switch localStorage, thiếu bundle là fail-fast); `renderer.js` vẫn giữ domain state/action. Chuẩn hóa project context `{ projectId, directory }` qua `src/project-context.js` — main chỉ resolve directory khớp `path`/`activeWorktreePath` đã đăng ký nên renderer input không thành filesystem authority. Thêm chỉ báo context-window trên composer (donut đổi màu theo ngưỡng + popover `used / total`). Sửa timeout lần chạy slash command đầu tiên (`RUNTIME_COMMAND_TIMEOUT_MS = 120s`) và chống nhân đôi prompt; render LaTeX inline bằng cách map lệnh một-token sang Unicode (app không ship KaTeX). Đồng bộ Node tối thiểu `>=20.19.0`, đổi icon sang `lucide-static`.

### [v1.13.11] - 2026-07-18

Nâng `opencode-ai` `1.17.18` → `1.18.3` (gộp `1.17.19`+). App chỉ tiêu thụ `opencode serve` nên phần Desktop/TUI của upstream không ảnh hưởng; các fix core có lợi: bỏ Codex workaround gây lỗi request OpenAI, fix crash Copilot batch size 0, Azure GPT-5.6/xAI/Luna OAuth. `1.18.2` chặn subagent lồng nhau theo mặc định (`subagent_depth`) — orthogonal với app. Không đổi frozen config schema.

### [v1.13.9] - 2026-07-15

Hạ `minWidth` cửa sổ `980px` → `520px` và làm lại layout responsive (≤820px sidebar thành overlay drawer; ≤640px ưu tiên chat, ẩn document viewer, gọn composer/settings). Sửa crash lần đầu mở app và làm cứng luồng nạp session/message: timeout có giới hạn cho mọi HTTP request tới runtime (mặc định 15s, health 1s, MCP auth 120s) và cho DB preflight (5s); health probe bám tổng deadline startup; renderer track load theo generation (`sessionLoadsByProject`/`messageLoadsBySession`) để có Loading/Retry, chống response cũ ghi đè và auto-retry khi runtime `running`. Đổi 3 suggestion prompt mặc định của màn New session.

### [v1.13.8] - 2026-07-14

Thêm **worktree/branch selector** (`src/git-worktree.js`): list branch/worktree, checkout branch hoặc switch worktree ngay trong app (git chạy bằng argument array, không qua shell), IPC `git:info` / `git:checkoutBranch` / `git:switchWorktree`, persist worktree đang chọn theo project và `repairProjectWorktrees` dọn `activeWorktreePath` hỏng. Redesign màn New session: hero + logo theo theme, grid suggestion card (click chỉ điền draft), composer dock kèm project selector có search.

### [v1.13.7] - 2026-07-12

Thêm mở project bằng IDE ngoài (`src/ide-launcher.js`): VS Code / Cursor / Antigravity qua `open -a`, lựa chọn `system` mở bằng Finder; IPC `open-ide`, split-button nhớ IDE mặc định. Đổi UI chế độ Plan sang card "Plan" collapsible inline trong thread (không còn mirror sang document viewer); action strip Reject / Revise / Accept chỉ hiện khi plan stream xong và turn đã settle.

### [v1.13.6] - 2026-07-10

Nâng `opencode-ai` `1.17.15` → `1.17.18`. Sửa lỗi "No handler registered for `auth:refresh`" sau khi upgrade app: tách boot sequence ra `src/main-bootstrap.js` để đăng ký IPC + mở window **trước** profile sync dễ throw, thêm `emitToRenderer()` giữ event một-lần cho tới khi renderer sẵn sàng. `ensureOpenworkingProfile` không bao giờ trả `null` nữa — lỗi sync trả profile `degraded: true` kèm `error` để app vẫn boot. Thêm guard Node version cho dev/test (`scripts/check-node.js`, `.nvmrc`).

### [v1.13.5] - 2026-07-08

Thêm chọn theme **Appearance** (System / Light / Dark) trong Settings: thuần renderer/CSS (không IPC), `data-theme` trên `<html>` + localStorage, mode `system` bám `prefers-color-scheme`, toggle stylesheet highlight.js theo theme; bổ sung bảng màu light. Nâng `opencode-ai` `1.17.13` → `1.17.15`. Sửa mất chip file/skill/command trên user message khi chạy command và khi thread rehydrate (persist metadata theo session, khớp theo `userOrdinal` + `signatureText`).

### [v1.13.4] - 2026-07-05

Thêm **guided tour** lần đầu chạy app (`src/renderer/onboarding.js`, 7 bước, spotlight bám anchor, nút "Replay tour" trong Settings). Cross-chat memory chọn được project để xem/sửa từ màn Memory (selector chỉ view/edit, không đổi active project; `memory:get`/`memory:save` nhận `projectId`). Redesign màn Projects thành lưới card có search live-filter; redesign Skills/Extensions theo mockup Directory (browse catalog + MCP preset gom vào một modal toàn màn hình). Refactor renderer theo hướng render islands: tách `src/renderer.js` thành các UMD module dưới `src/renderer/`, thay if-chain `handleAction` bằng dispatch table, paint từng island tại chỗ. Sửa không mở được file đã bị rename/move (trạng thái `missing` thay vì throw).

### [v1.13.1] - 2026-07-03

Chuyển composer sang **token contenteditable** chuẩn hóa cho file/skill/command mention (`TOKEN_KINDS`, `parsePromptTokens`, chip `contenteditable=false`), tạo token được ngay trong ô nhập. Đồng bộ command do app quản lý vào `<profile>/commands/` (`syncManagedCommandFiles`, whitelist tên). Thêm **reasoning effort** chọn theo session trên composer (None / Medium / High / Extra High), lưu theo session và ghi vào model options trước khi gửi; bỏ `reasoning_effort`/`include_reasoning` khỏi `DEFAULT_MODEL_OPTIONS`. Nâng `opencode-ai` `1.17.12` → `1.17.13`. Thêm migration schema runtime DB (`src/runtime/db-schema.js`, cột `replacement_seq`).

### [v1.13.0] - 2026-07-01

Thêm **Browser Use**: agent điều khiển Chrome đang đăng nhập của người dùng qua MCP (bundle extension + native-messaging host + browser MCP server, skill `browser-use`, tools `browser_*`, IPC `browser:*`; host/MCP nói chuyện qua `127.0.0.1` kèm token, extension allowlist theo id cố định, hành động mutating vẫn qua permission ask). Thêm **catalog skills** cài theo nhu cầu từ API remote (client `skill-catalog`, track `installedCatalog` trong manifest, UI 4 nhóm Engineer/Product Design/APO/APM). Thêm hỗ trợ attachment `.zip` (sinh Markdown context, có giới hạn entry/kích thước). Nâng `opencode-ai` `1.17.9` → `1.17.12`. Ẩn session do subagent tạo khỏi session list. Bảo mật: `form-data` `4.0.5` → `4.0.6` (CRLF injection), catalog download chặn `http://` ngoài loopback. Thêm playbook agent loop (`AGENTS.md`, `.agents/commands/`, `.claude/commands/`).

### [v1.12.3] - 2026-06-24

Cải thiện skill `translate-office-document`, tập trung PPTX: OCR ảnh trong slide thành best-effort (ảnh lỗi thì giữ nguyên + cảnh báo, vẫn dịch text slide và vẫn xuất artifact thay vì fail cả lần dịch); gom logic vision vào `requestVisionBlocks` dùng chung PPTX/PDF; thêm `salvageTruncatedJson` vớt JSON bị cắt cụt từ gateway.

### [v1.12.2] - 2026-06-23

Thêm **fork chat session**: nút "Fork chat" trên mỗi câu trả lời, IPC `runtime:forkSession` gọi `POST /session/{id}/fork`, marker "Forked from conversation" trong thread. Cải thiện chế độ Plan bám sát plan-native của OpenCode (prompt mới khuyến khích `question` + `todowrite`, `ensureDefaultAgentPrompt` nâng cấp prompt cũ nhưng giữ nguyên prompt user đã sửa, renderer render checklist plan). Tinh gọn header (48px → 44px, bỏ path phụ và status pill). Sửa version check trên máy Intel (truyền thêm `arch`).

### [v1.12.1] - 2026-06-22

Thêm modal xác nhận xóa chat session (thay `confirm()`), hover hint cạnh con trỏ trên các divider resize. Spawn MCP Backlog đáng tin cậy hơn: `src/mcp-install.js` cài `backlog-mcp-server` (pin `0.12.0`) vào thư mục trung lập và chạy bằng `node <entry>` thay vì `npx`, tránh `EBADDEVENGINES` của package manager project. Đồng bộ `opencode.json` sang `XDG_CONFIG_HOME` riêng của runtime. Sửa panel/document preview co sai khi resize (clamp đo layout thực, guard giá trị non-finite tránh track `NaNpx` làm sập grid). Dedupe session theo `id` và lọc theo `directory` đúng project.

### [v1.12.0] - 2026-06-21

Thêm **cross-chat memory** (skill `cross-chat-memory` + tool `remember.js`, memory global và theo project trong app-managed profile, tự gắn vào `instructions` khi mở project, UI Memory trong màn Skills). Thêm **pin** chat session (`pinned-sessions.json`) và project, sidebar có khu vực `Pinned`. Thêm xem history chat theo từng project từ sidebar (runtime lấy session/message theo `directory`, không cần spawn runtime riêng). Thêm Backlog MCP preset (local stdio) và hỗ trợ env vars cho local MCP server. Nâng `opencode-ai` `1.17.8` → `1.17.9`. Giảm kích thước app ~61 MB (~15%) bằng cách loại `.map`/`.d.ts`/`.ts`/test/example và trim Mermaid. Sửa luồng thread rehydration khi session đang stream (theo dõi `lastStreamEventAt`/`lastAssistantOutputAt`, tránh rehydrate quá sớm) và endpoint reply question/permission theo API mới.
