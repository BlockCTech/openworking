# TechTusCoWork — Documentation Index

Tài liệu của `desktop-client/` được tổ chức theo **giai đoạn SDLC** (đánh số theo thứ tự đọc tự nhiên). Mỗi tài liệu hiện trạng ("as-built") theo skeleton design-doc của Google: *Context → Design → Cross-cutting/Security → References*.

> Đây là index. Bắt đầu nhanh: đọc `00` → `01` để nắm sản phẩm + kiến trúc, rồi nhảy tới miền bạn đang sửa.
> Bối cảnh sản phẩm cấp cao + lệnh build nằm ở [`../README.md`](../README.md) và workspace-root [`../../CLAUDE.md`](../../CLAUDE.md).

## Theo giai đoạn SDLC

| Giai đoạn | Thư mục | Tài liệu | Nội dung |
|---|---|---|---|
| **Product / UX** | `00-product/` | [session-first-ux.md](00-product/session-first-ux.md) | Phase-1 session-first UX: required shell, workflow, diagnostics, production-data rule. |
| **Architecture** | `01-architecture/` | [architecture-overview.md](01-architecture/architecture-overview.md) | ★ Bản đồ tổng thể: 3-process model, IPC surface, runtime lifecycle, security boundaries, module↔test map. **Đọc trước khi sửa code.** |
| **Auth & LLM token** | `02-auth/` | [sso-login-and-llm-token.md](02-auth/sso-login-and-llm-token.md) | ★ Hiện trạng hợp nhất: SAML2 SSO qua Portal Hub (web-ACS broker, loopback handoff), session storage, RFC 8693 token exchange, Gateway JWT contract, failure modes. |
| **Skills & Runtime** | `03-skills-runtime/` | [built-in-skills.md](03-skills-runtime/built-in-skills.md) | Bundle 14 skill offline, sync idempotent, slash commands, MCP/Extensions. |
| | | [local-llm-proxy.md](03-skills-runtime/local-llm-proxy.md) | ★ Proxy 127.0.0.1 đổi local token → Gateway JWT khi forward. |
| | | [attachments-office-context.md](03-skills-runtime/attachments-office-context.md) | ★ Attachment registry, trích ngữ cảnh XLSX/PPTX, artifact-path security boundary. |
| **Release & Packaging** | `04-release-packaging/` | [local-run-verification.md](04-release-packaging/local-run-verification.md) | Verify MVP local: runtime contract + manual/automated checks. |
| | | [version-check-update.md](04-release-packaging/version-check-update.md) | ★ Version check (soft/force) + download + auto-install DMG. |
| | | [reduce-dmg-size.md](04-release-packaging/reduce-dmg-size.md) | Decision doc: phân tích & khuyến nghị giảm size `.dmg`. |
| **Operations** | `05-operations/` | [current-behavior-issues.md](05-operations/current-behavior-issues.md) | Nhật ký lỗi hành vi quan sát được (review findings). |

★ = tài liệu hiện trạng mới bổ sung cho module trước đây chưa có doc.

## Đọc theo thứ tự nào

- **Kỹ sư mới / AI agent:** `01-architecture/architecture-overview.md` trước (có module↔test map) → rồi doc của miền đang chạm.
- **Làm về đăng nhập / LLM token:** [`02-auth/sso-login-and-llm-token.md`](02-auth/sso-login-and-llm-token.md) (hiện trạng đầy đủ cả login + token exchange).
- **Làm về build/phát hành:** `04-release-packaging/` + mục "Releasing / Bumping Version" trong [`../README.md`](../README.md).

## Ngoài phạm vi thư mục này

Workspace-root `../../docs/` chứa contract dùng chung backend/frontend, **không** thuộc desktop-client:
- `../../docs/sso-login.md` — design SSO end-to-end (backend + frontend + desktop).
- `../../docs/upgrade_version.md` — contract API version-check phía server (được [version-check-update.md](04-release-packaging/version-check-update.md) tham chiếu).
