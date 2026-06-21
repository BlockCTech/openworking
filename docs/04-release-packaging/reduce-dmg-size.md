# Giảm kích thước app `.dmg` — Phân tích & Khuyến nghị

> **Loại tài liệu:** Decision document (phân tích kỹ thuật + khuyến nghị).
> **Phạm vi:** macOS arm64 build của `OpenWorking` (package `openworking`).
> **Ràng buộc đã chốt:** Giữ nguyên tính năng (không bỏ skill, không bỏ document-tools, **giữ offline-first** — không tải runtime opencode sau khi cài). Chỉ loại trùng lặp / file thừa và nén tốt hơn.
> **Trạng thái:** ĐÃ ÁP DỤNG (2026-06-19) — xem §0. Phần phân tích bên dưới giữ nguyên làm tham chiếu lịch sử.
> **Số liệu phân tích gốc đo từ bản build `dist/` ngày 2026-06-03.**

---

## 0. Đã thực hiện (2026-06-19)

Tất cả thay đổi nằm trong `package.json` (`build.files`). **Không sửa code app.** Verify bằng `npm test` (226 pass) + `npm run smoke:packaged` (pass, gồm `rendersMermaidDiagram=true`).

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| A — document-tools deps → devDependencies | ✅ Phần lớn đã sẵn | `pdf-lib`, `@pdf-lib/fontkit`, `@embedpdf/pdfium`, `pngjs`, `zod` đã ở devDeps từ trước. **`adm-zip` GIỮ Ở `dependencies`** vì main process dùng (`src/opencode-profile.js`, `src/office-attachment-context.js`) — doc cũ liệt sai. |
| B — trim `@highlightjs/cdn-assets` | ✅ Đã có sẵn | |
| C — `electronLanguages: ["en"]` | ✅ Đã có sẵn | |
| E — DMG `ULFO` | ✅ Đã có sẵn | |
| D — siết `files` (`.map`/`.d.ts`/`.ts`, test/example dirs) | ✅ Mới | Cố ý **không** loại `.md`/`docs/` để tránh phá dep. |
| 🆕 Trim `node_modules/mermaid` → chỉ `mermaid.min.js` | ✅ Mới | UMD bundle self-contained (0 dynamic import). |
| 🆕 Loại transitive deps chỉ-của-mermaid | ✅ Mới | `d3*`, `cytoscape*`, `katex`, `es-toolkit`, `dompurify`, `@mermaid-js`, `lodash-es`, `roughjs`… — verified bằng `npm ls` chỉ thuộc mermaid; renderer load UMD nên không cần. |

**Kết quả đo (arm64):**

| Artifact | Trước (2026-06-03) | Sau (2026-06-19) | Giảm |
|---|---|---|---|
| `.app` | 409 MB | **348 MB** | −61 MB (~15%) |
| `app.asar` | 42 MB | **5.4 MB** | −36 MB (~87%) |
| `app.asar.unpacked` (binary opencode) | 103 MB | 123 MB | (trần cứng, không đụng) |

Phần còn lại không giảm thêm được trong ràng buộc hiện tại: Electron Framework (~253 MB) + binary opencode (~108–123 MB).

---

## 1. Tóm tắt điều hành

App build hiện tại: **DMG 160 MB**, **`.app` 409 MB**.

Hai thành phần lớn nhất gần như **không thể cắt** nếu giữ tính năng + offline-first:

- **Electron Framework: 253 MB** (Chromium + V8 + Node) — khung cố định của mọi app Electron.
- **Binary `opencode`: ~108 MB** (Mach-O arm64) — nhúng sẵn để chạy offline.

→ **Trần dưới thực tế** ≈ **~360 MB `.app` / ~150 MB DMG**. Đừng kỳ vọng giảm sâu hơn mức này nếu không đổi kiến trúc (xem §6).

**Phần "mỡ thừa" có thể cắt an toàn, không mất tính năng:**

| Hạng mục | Ước tính tiết kiệm |
|---|---|
| Deps document-tools bị ship trùng (đã bundle sẵn) | **~25–35 MB** (asar) |
| `@highlightjs/cdn-assets` ship cả gói thay vì subset | **~5–6 MB** |
| Locale rỗng + file thừa (`.md`, `.map`, `.d.ts`, `test/`) | **~vài MB** |
| Nén DMG mạnh hơn (ULFO) — chỉ giảm file tải về | **~10–25% DMG** |

**Khuyến nghị ưu tiên: A → E → B → C → D** (chi tiết §5).

---

## 2. Phân rã kích thước (đo thực tế)

### 2.1 Bản build hiện tại

| Artifact | Size |
|---|---|
| `dist/OpenWorking-1.0.0-arm64.dmg` | **160 MB** |
| `dist/mac-arm64/OpenWorking.app` | **409 MB** |

### 2.2 Bên trong `.app` (409 MB)

| Thành phần | Size | Ghi chú |
|---|---|---|
| `Contents/Frameworks/Electron Framework.framework` | **253 MB** | Chromium + V8 + Node — gần như cố định |
| `Resources/app.asar.unpacked` | **103 MB** | Binary `opencode-darwin-arm64/bin/opencode` (Mach-O arm64) |
| `Resources/app.asar` | **42 MB** | Toàn bộ production `node_modules/**` đã pack |
| `Resources/opencode` (extraResources) | **10 MB** | skills + schemas + tools + document-tools |
| icon / helpers / locales | ~1 MB | nhiều `*.lproj` rỗng (0 B) |

### 2.3 Đóng góp vào `app.asar` (42 MB) — production deps

| Package | Size on disk | Dùng ở đâu (đã verify bằng grep) |
|---|---|---|
| `pdf-lib` | 23 MB | **chỉ** `src/document-tools/runtime.js` |
| `@embedpdf/pdfium` | 7.2 MB | **chỉ** `src/document-tools/runtime.js` |
| `zod` | 6.3 MB | **chỉ** `src/document-tools/schema.js` |
| `@highlightjs/cdn-assets` | 6.1 MB | renderer — `index.html` chỉ load `highlight.min.js` (120 KB) + 1 stylesheet |
| `@pdf-lib/fontkit` | 5.7 MB | **chỉ** `src/document-tools/runtime.js` |
| `ajv` | 2.3 MB | `src/opencode-config.js` (main — **cần giữ**) |
| `pngjs` | 704 KB | **chỉ** `src/document-tools/runtime.js` |
| `marked` | 460 KB | renderer (`index.html`) — **cần giữ** |
| `adm-zip` | 164 KB | **chỉ** `src/document-tools/runtime.js` |
| `mime-types` | 28 KB | `src/attachment-registry.js` (main — **cần giữ**) |

> Số "size on disk" lớn hơn phần đóng góp thực vào asar (asar có nén), nhưng tỷ lệ tương đối giữa các package vẫn đúng — các deps document-tools chiếm phần áp đảo của 42 MB.

---

## 3. Phát hiện cốt lõi

### 3.1 ⭐ Deps của document-tools bị ship **2 lần**

`src/document-tools/runtime.js` và `schema.js` được **esbuild bundle sẵn** (qua `scripts/build-document-tools.js`) thành các file standalone trong `resources/opencode/document-tools/`:

```
runtime.cjs   3.7 MB   (đã chứa pdf-lib, fontkit, pdfium loader, pngjs, adm-zip)
schema.cjs    700 KB   (đã chứa zod)
pdfium.wasm   4.4 MB
assets/       556 KB   (NotoSans-Regular.ttf, …)
```

Đây là runtime **độc lập** mà skill `translate-document` gọi tới — main-process Electron **không bao giờ** `require` các package này (đã verify: chỉ duy nhất `src/document-tools/runtime.js` import chúng).

**Nhưng** vì các package đó nằm trong `dependencies` của `package.json`, electron-builder pack **nguyên cả `node_modules/`** của chúng vào `app.asar`. Kết quả: `pdf-lib`, `@pdf-lib/fontkit`, `@embedpdf/pdfium`, `pngjs`, `adm-zip`, `zod` bị **ship hai lần** — một lần đã bundle trong `runtime.cjs`/`schema.cjs` (cần thiết), một lần dạng node_modules thô trong asar (thừa).

→ **Chuyển 6 package này sang `devDependencies`** sẽ loại bản thừa khỏi asar mà **không mất tính năng**, vì runtime.cjs/schema.cjs đã tự chứa. Esbuild vẫn resolve được lúc build vì devDependencies vẫn được cài khi `npm install`.

### 3.2 `@highlightjs/cdn-assets` ship dư

`src/index.html` chỉ tham chiếu:

```html
<script src="../node_modules/@highlightjs/cdn-assets/highlight.min.js"></script>
<link rel="stylesheet" href="../node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css">
```

Tức **~120 KB JS + 1 stylesheet**. Nhưng cả gói `@highlightjs/cdn-assets` **6.1 MB** (toàn bộ `languages/`, `es/`, tất cả theme trong `styles/`) bị pack vào asar do `files` whitelist dùng `node_modules/**/*`.

### 3.3 Locale `.lproj` rỗng

Bản build có hàng chục thư mục `Resources/*.lproj` (vi, zh_CN, ru, …) **0 B mỗi cái**. Không tốn dung lượng đáng kể nhưng làm bundle lộn xộn; có thể loại bằng `electronLanguages`.

### 3.4 Binary `opencode` 108 MB là trần cứng (theo ràng buộc)

Đây là phần lớn thứ 2 sau Electron Framework. Giữ offline-first nghĩa là phải nhúng sẵn → không né được. Đây là giới hạn dưới của size.

### 3.5 (Rủi ro) Không vô tình ship 2 bản binary opencode

`asarUnpack` hiện tại:

```json
"asarUnpack": ["node_modules/opencode-*/**/*"]
```

Glob này về lý thuyết match **cả hai**:
- `opencode-darwin-arm64/bin/opencode` (Mach-O arm64, 108 MB)
- `opencode-ai/bin/opencode.exe` (cũng là **Mach-O arm64 108 MB** — bị đặt tên `.exe` nhầm; trên đĩa là hardlink cùng inode với file trên)

**Đã verify** trong bản build hiện tại: chỉ `opencode-darwin-arm64` lọt vào `app.asar.unpacked` (103 MB), `opencode-ai/bin` **không** bị unpack → chỉ 1 bản. Đây là điều **tốt cần duy trì**. Nếu sau này refactor glob/`files`, phải verify lại bằng:

```sh
du -sh dist/mac-arm64/OpenWorking.app/Contents/Resources/app.asar.unpacked
```

Nếu con số nhảy lên ~206 MB → đã vô tình ship 2 bản.

`resolveRuntimeBin()` (`src/runtime/process-manager.js`) tìm binary theo thứ tự: `app.asar.unpacked/.../opencode-${platform}-${arch}/bin/opencode` trước, rồi mới fallback sang `opencode-ai/bin/opencode.exe`. Nên giữ bản `opencode-darwin-arm64` unpacked là đủ.

---

## 4. Giải pháp + tradeoff

Mỗi mục: *mô tả → tiết kiệm → tradeoff → việc cần làm / verify → khuyến nghị*.

### A. ⭐ Chuyển deps document-tools sang `devDependencies` — **quick win lớn nhất**

- **Mô tả:** chuyển `pdf-lib`, `@pdf-lib/fontkit`, `@embedpdf/pdfium`, `pngjs`, `adm-zip`, `zod` từ `dependencies` → `devDependencies`. Chúng đã được bundle sẵn vào `resources/opencode/document-tools/runtime.cjs` + `schema.cjs`; main process không dùng.
- **Tiết kiệm:** loại phần áp đảo của asar 42 MB → ước tính **~25–35 MB**.
- **Tradeoff:** **không có** về tính năng. Translate-document vẫn chạy từ `runtime.cjs`.
- **Việc cần làm / verify:**
  - Giữ chúng ở `devDependencies` (không xoá hẳn) để `npm run build:document-tools` (esbuild) còn resolve lúc build.
  - Chạy `npm test` (đảm bảo main không lỡ import).
  - Chạy `npm run smoke:packaged` — test này check `runtime.cjs`, `schema.cjs`, `pdfium.wasm`, `assets/NotoSans-Regular.ttf` tồn tại trong `Resources/opencode/document-tools/` (không động tới node_modules đó), nên phải vẫn **pass**.
  - Đo lại `du -sh .../app.asar` trước/sau.
- **Khuyến nghị:** ✅ Làm trước tiên.

### B. ⭐ Trim `@highlightjs/cdn-assets`

- **Mô tả:** chỉ giữ `highlight.min.js` + stylesheet đang dùng (`styles/github-dark.min.css`). Hai cách:
  1. Thêm negation pattern vào electron-builder `files` để loại `languages/`, `es/`, các theme khác.
  2. Hoặc copy 2 file cần thiết vào `src/vendor/` và sửa `src/index.html` trỏ tới đó, rồi đưa `@highlightjs/cdn-assets` về devDependencies.
- **Tiết kiệm:** ~5–6 MB (trước nén).
- **Tradeoff:** nếu sau này cần thêm ngôn ngữ/theme phải bổ sung lại. Thấp.
- **Verify:** mở app, kiểm tra code block trong chat thread vẫn highlight đúng (`src/renderer.js` dùng `hljs.highlight`).
- **Khuyến nghị:** ✅ Nên làm.

### C. Loại locale rỗng + tinh chỉnh đóng gói

- **Mô tả:** đặt `electronLanguages: ["en"]` (hoặc tập ngôn ngữ thực dùng) để bỏ các `.lproj` rỗng. Tận dụng `removePackageScripts`/`removePackageKeywords` (mặc định đã bật) để gọn metadata.
- **Tiết kiệm:** nhỏ (vài MB / dọn rác), nhưng gần như miễn phí.
- **Tradeoff:** không hỗ trợ locale hệ điều hành khác (không liên quan vì UI tự quản ngôn ngữ).
- **Khuyến nghị:** ✅ Rẻ, làm kèm.

### D. Siết `files` whitelist thay vì `node_modules/**/*`

- **Mô tả:** hiện `files: ["src/**/*", "node_modules/**/*", "package.json"]`. electron-builder đã tự prune devDeps, nhưng vẫn kéo `*.md`, `*.map`, `*.d.ts`, `test/`, `docs/` của các prod-deps còn lại. Thêm các pattern loại:
  ```json
  "!**/*.{md,map,d.ts}",
  "!**/{test,tests,docs,example,examples}/**"
  ```
- **Tiết kiệm:** ~2–5 MB.
- **Tradeoff:** phải cẩn thận không loại nhầm file runtime; cần verify kỹ.
- **Verify:** `npm run smoke:packaged` + chạy thử app.
- **Khuyến nghị:** ◻️ Tùy chọn (làm sau A/B/C).

### E. ⭐ Nén DMG mạnh hơn (không động code app)

- **Mô tả:** electron-builder mặc định nén DMG bằng UDZO. Đặt `dmg.format: "ULFO"` (LZMA) để giảm size **file `.dmg` tải về**. App cài ra đĩa không đổi.
  ```json
  "dmg": { "format": "ULFO" }
  ```
- **Tiết kiệm:** ~10–25% trên `.dmg` (giảm băng thông tải về).
- **Tradeoff:** build lâu hơn chút; ULFO yêu cầu macOS ≥ 10.11 (không vấn đề).
- **Khuyến nghị:** ✅ Rất rẻ — chỉ thêm config, không rủi ro tính năng.

### F. (Ghi chú rủi ro — không phải giải pháp) Giữ 1 bản binary opencode

- Như §3.5: giữ `asarUnpack` hiện tại; nếu refactor, verify `app.asar.unpacked` không nhảy lên ~206 MB.

---

## 5. Bảng tổng hợp ưu tiên

| # | Giải pháp | Tiết kiệm ước tính | Effort | Rủi ro | Khuyến nghị |
|---|---|---|---|---|---|
| **A** | document-tools deps → devDependencies | **~25–35 MB** (asar) | Thấp | Thấp (cần verify smoke) | ✅ Làm trước |
| **E** | DMG format `ULFO` | ~10–25% DMG | Rất thấp | Rất thấp | ✅ |
| **B** | Trim `@highlightjs/cdn-assets` | ~5–6 MB | Thấp | Thấp | ✅ |
| **C** | `electronLanguages` + locale rỗng | vài MB | Rất thấp | Rất thấp | ✅ |
| **D** | Siết `files` whitelist | 2–5 MB | TB | TB | ◻️ Tùy chọn |

**Kết quả kỳ vọng sau A+B+C+E:** `.app` từ 409 MB → **~365–375 MB**; DMG từ 160 MB → **~120–135 MB** (nhờ vừa cắt nội dung vừa nén ULFO). Phần lớn dung lượng còn lại là Electron Framework (253 MB) + binary opencode (108 MB) — bất khả giảm trong ràng buộc hiện tại.

---

## 6. Các hướng KHÔNG khuyến nghị (ghi để minh bạch tradeoff)

| Hướng | Tiết kiệm tiềm năng | Vì sao loại |
|---|---|---|
| Tải binary opencode (108 MB) sau khi cài | ~108 MB DMG | Phá **offline-first** — cần mạng lần đầu chạy; rủi ro lỗi tải, version drift. Ràng buộc đã loại. |
| Bỏ bớt skill / document-tools | 5–10 MB | **Mất tính năng**. Ràng buộc đã loại. |
| Thay Electron bằng Tauri (WebView hệ điều hành) | ~200 MB+ | Loại bỏ Chromium nhúng nhưng **viết lại toàn bộ vỏ app**, đổi ngôn ngữ (Rust), rủi ro tương thích. Ngoài phạm vi MVP. |
| Strip/nén binary opencode | ? | Binary của bên thứ ba (opencode-ai); không nên tự strip — rủi ro hỏng chữ ký/chức năng. |

---

## 7. Cách kiểm chứng (sau mỗi thay đổi)

**Đo size trước/sau:**

```sh
du -sh dist/mac-arm64/OpenWorking.app
du -sh dist/*.dmg
du -sh dist/mac-arm64/OpenWorking.app/Contents/Resources/app.asar
du -sh dist/mac-arm64/OpenWorking.app/Contents/Resources/app.asar.unpacked
```

**Soi nội dung asar (xem package nào còn trong đó):**

```sh
npx asar list dist/mac-arm64/OpenWorking.app/Contents/Resources/app.asar | grep '^/node_modules/[^/]*$'
```

**Phải PASS sau mọi thay đổi (cổng an toàn):**

```sh
npm test               # unit tests
npm run smoke:packaged # build .app thật + assert: binary opencode, 14 skills,
                       # schemas, translate_document tool, document-tools assets
                       # (runtime.cjs / schema.cjs / pdfium.wasm / NotoSans) đều có mặt
```

`smoke:packaged` (`scripts/packaged-smoke.js`) là cổng quan trọng nhất: nó dựng bản đóng gói rồi kiểm tra mọi artifact runtime tồn tại + app khởi động được với `PATH` tối thiểu (không có opencode CLI toàn cục). Nếu pass nghĩa là việc cắt giảm **không phá** runtime/skills.

---

## 8. Phụ lục — nguồn số liệu & file liên quan

- Build config: `package.json` → key `build` (electron-builder: `asar`, `asarUnpack`, `files`, `extraResources`, `mac.target`).
- Bundle document-tools: `scripts/build-document-tools.js` (esbuild → `runtime.cjs`, `schema.cjs`, copy `pdfium.wasm`).
- Cổng kiểm thử đóng gói: `scripts/packaged-smoke.js`.
- Giải binary runtime: `resolveRuntimeBin()` trong `src/runtime/process-manager.js`.
- Import deps nặng (chỉ document-tools): `src/document-tools/runtime.js`, `src/document-tools/schema.js`.
- Renderer dùng marked/highlight: `src/index.html`, `src/renderer.js`.
- Số đo lấy từ `dist/` (build arm64) ngày 2026-06-03 bằng `du -sh` và `npx asar list`.
