// Popup: reflect and refresh the native-host connection status reported by the service worker.
const dot = document.getElementById("dot")
const label = document.getElementById("label")

function render(connected) {
  dot.className = "dot " + (connected ? "on" : "off")
  label.textContent = connected ? "Host connected" : "Host not connected"
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (response) => {
    render(!!(response && response.connected))
  })
}

document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "connect" }, (response) => {
    render(!!(response && response.connected))
  })
})

refresh()
