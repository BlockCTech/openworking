// MV3 service worker: bridges the native-messaging host to DOM actions on the user's active tab.
// It receives { id, op, params } commands from the host and replies { id, ok, result } | { id, ok:false, error }.
// DOM work is injected on demand into the active tab via chrome.scripting (activeTab), so the extension
// needs no static <all_urls> content script. The desktop app gates mutating ops (click/type) before the
// host ever forwards them, so this worker just executes what it is asked.

const HOST_NAME = "ai.inworking.openworking.browser_host"

let port = null
let reconnectTimer = null
let reconnectDelay = 500
const MAX_RECONNECT_DELAY = 5000

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectDelay)
  // Exponential backoff, capped, so a host that keeps dying (e.g. missing token) does not spin.
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
}

function connect() {
  if (port) return
  try {
    port = chrome.runtime.connectNative(HOST_NAME)
  } catch (error) {
    port = null
    scheduleReconnect()
    return
  }
  // A live native port keeps the host process up. Reset backoff on a successful (re)connect.
  reconnectDelay = 500
  port.onMessage.addListener(onCommand)
  port.onDisconnect.addListener(() => {
    // Reading lastError both clears Chrome's "Unchecked runtime.lastError" warning and surfaces the
    // real disconnect reason (e.g. host not installed / manifest mismatch) for troubleshooting.
    const error = chrome.runtime.lastError
    if (error) console.warn("browser host disconnected:", error.message)
    // Chrome tears down the host when the MV3 worker is suspended or the host exits. Reconnect
    // proactively (with backoff) rather than waiting for the next command, so the host is alive when
    // the MCP needs it.
    port = null
    scheduleReconnect()
  })
}

function ensurePort() {
  if (!port) connect()
  return port
}

// Heartbeat: chrome.alarms survives MV3 worker suspension and wakes the worker, which re-establishes the
// native port (and thus keeps the host alive) during idle periods. 0.5 min is Chrome's minimum period.
chrome.alarms.create("keepalive", { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") ensurePort()
})

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error("no active tab")
  return tab
}

// Injected into the page. Builds a compact snapshot of visible text + interactive elements, each keyed
// by a stable ref so click/type can target it later. Returns plain JSON (structured-clonable).
function snapshotPage() {
  const interactive = []
  const selector = "a,button,input,textarea,select,[role=button],[role=link],[contenteditable=true]"
  let counter = 0
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const ref = "e" + ++counter
    el.setAttribute("data-techtus-ref", ref)
    interactive.push({
      ref,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || undefined,
      name: el.getAttribute("name") || undefined,
      text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 200)
    })
    if (counter >= 200) break
  }
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : "").slice(0, 20000),
    elements: interactive
  }
}

function clickRef(ref) {
  const el = document.querySelector(`[data-techtus-ref="${ref}"]`)
  if (!el) return { ok: false, error: "element not found" }
  el.scrollIntoView({ block: "center" })
  el.click()
  return { ok: true }
}

function typeRef(ref, text) {
  const el = document.querySelector(`[data-techtus-ref="${ref}"]`)
  if (!el) return { ok: false, error: "element not found" }
  el.focus()
  if ("value" in el) {
    el.value = text
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  } else if (el.isContentEditable) {
    el.textContent = text
    el.dispatchEvent(new Event("input", { bubbles: true }))
  } else {
    return { ok: false, error: "element is not editable" }
  }
  return { ok: true }
}

async function runInTab(tabId, func, args) {
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
  return result
}

async function execute(op, params) {
  const tab = await activeTab()
  switch (op) {
    case "navigate": {
      if (!params || typeof params.url !== "string") throw new Error("navigate requires a url")
      await chrome.tabs.update(tab.id, { url: params.url })
      return { url: params.url }
    }
    case "read":
      return runInTab(tab.id, snapshotPage)
    case "click": {
      const outcome = await runInTab(tab.id, clickRef, [params && params.ref])
      if (!outcome || !outcome.ok) throw new Error(outcome && outcome.error ? outcome.error : "click failed")
      return { clicked: params.ref }
    }
    case "type": {
      const outcome = await runInTab(tab.id, typeRef, [params && params.ref, (params && params.text) || ""])
      if (!outcome || !outcome.ok) throw new Error(outcome && outcome.error ? outcome.error : "type failed")
      return { typed: params.ref }
    }
    case "screenshot": {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      return { dataUrl }
    }
    default:
      throw new Error(`unknown op: ${op}`)
  }
}

async function onCommand(message) {
  if (!message || typeof message.id !== "string") return
  try {
    const result = await execute(message.op, message.params)
    port && port.postMessage({ id: message.id, ok: true, result })
  } catch (error) {
    port && port.postMessage({ id: message.id, ok: false, error: String(error && error.message ? error.message : error) })
  }
}

// Expose connection status to the popup.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request && request.type === "status") {
    sendResponse({ connected: !!port })
  } else if (request && request.type === "connect") {
    connect()
    sendResponse({ connected: !!port })
  }
  return true
})

// Reconnect whenever Chrome (re)starts the worker for any reason — install, browser startup, or an
// event waking a suspended worker. Each is a chance to bring the native host back up before a tool call.
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)

connect()
