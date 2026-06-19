# Local LLM Proxy (as-built)

> **Loại tài liệu:** As-built reference cho `src/local-llm-proxy.js` (+ `test/local-llm-proxy.test.js`).
> **Liên quan:** contract token exchange ở [`../02-auth/sso-login-and-llm-token.md`](../02-auth/sso-login-and-llm-token.md) (không lặp lại ở đây).

## Context

OpenCode child cần một endpoint OpenAI-compatible để gọi LLM, nhưng **không được** giữ Gateway JWT/long-lived key. `LocalLlmProxy` là cầu nối chạy trong main process: bind `127.0.0.1` cổng ngẫu nhiên, nhận request từ OpenCode bằng per-run token, rồi thay `Authorization` bằng Gateway JWT khi forward tới LLM Gateway.

## Design

### Lifecycle
- `start()`: sinh `token` ngẫu nhiên (`crypto.randomBytes(32).base64url`), tạo HTTP server, `listen(0, "127.0.0.1")` → cổng ngẫu nhiên. Yêu cầu phải cấu hình `getGatewayToken` (nếu không → throw). Trả `snapshot()`.
- `stop()`: đóng server, xoá token/port/Gateway token trong memory.
- `env()`: trả `{ TECHTUS_LOCAL_PROXY_TOKEN: token }` khi đang chạy — đây là **giá trị duy nhất** main inject cho OpenCode (`getManagedSecretEnv` ở `src/main.js`).
- `baseURL`: `http://127.0.0.1:<port>/api/v1`.

### Request flow (`handle` → `forward`)
1. **Local auth gate**: `Authorization` của caller phải đúng `Bearer <token>`, sai → `401`.
2. **Body cap**: đọc tối đa `MAX_REQUEST_BYTES = 32 MiB`, vượt → huỷ request.
3. **Force streaming**: với `POST /chat/completions` (hoặc `/api/v1/chat/completions`) body JSON chưa có khoá `stream` → thêm `stream: true`.
4. **Strip + rewrite headers** (`forwardHeaders`): xoá `authorization`, `host`, `connection`, `content-length`, `proxy-authorization`, `transfer-encoding` của caller; set `Authorization: Bearer <gateway_jwt>`.
5. **Forward** tới `targetURLFor(gatewayBaseURL, req.url)` (map `/api/v1/*` → gateway base), pipe nguyên streaming response về OpenCode.

### Gateway token cache (`gatewayBearer`)
- Cache `{ accessToken, expiresAt }` trong memory. Tái dùng khi còn hơn `REFRESH_SKEW_MS = 90s` trước hạn.
- Dedupe refresh đồng thời qua `gatewayTokenPromise` (chỉ 1 lần gọi `getGatewayToken()` cho nhiều request song song).
- **Retry 401 một lần**: nếu gateway trả `401`, xoá cache, gọi `forward(..., retried=true)` để ép refresh token rồi thử lại đúng một lần.

### Cấu hình
- `gatewayBaseURL`: mặc định `DEFAULT_GATEWAY_BASE_URL = https://techtus-llm.mynavitechtus.vn/api/v1`, override bằng env `OPENWORKING_LLM_GATEWAY_BASE_URL`.

## Cross-cutting / Security
- Bind **chỉ** `127.0.0.1`, cổng ngẫu nhiên, token ngẫu nhiên mỗi lần chạy.
- **Không** persist Gateway JWT hay local proxy token (memory only).
- **Strip** `Authorization` của caller trước khi forward — Gateway JWT không bao giờ lộ ngược về OpenCode.
- Fail-closed: lỗi exchange/forward → trả error status (mặc định `502`), không forward lén.
- Export công khai: `{ DEFAULT_GATEWAY_BASE_URL, LocalLlmProxy, targetURLFor }`.

## Tham chiếu
- Code: `src/local-llm-proxy.js` · wiring: `src/main.js` (`localLlmProxy.env()`, `getManagedSecretEnv`).
- Token exchange + SSO login phía AI Console: [`../02-auth/sso-login-and-llm-token.md`](../02-auth/sso-login-and-llm-token.md).
