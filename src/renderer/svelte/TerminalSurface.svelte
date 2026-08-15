<script>
  // Owns the actual xterm.js Terminal instance. Mounted/unmounted by TerminalPanel exactly when a
  // terminal should be visible, so onMount/onDestroy are the natural place to create/dispose it —
  // no manual $effect-based mount bookkeeping needed. Registers its write() into ctx.terminalBridge
  // so renderer.js can push incoming pty.data chunks straight into the buffer without a Svelte
  // render per chunk (see the terminalBridge comment in renderer.js).
  import { onMount } from "svelte"
  import { Terminal } from "@xterm/xterm"
  import { FitAddon } from "@xterm/addon-fit"
  import "@xterm/xterm/css/xterm.css"

  let { ctx } = $props()
  let host

  // xterm has its own color model, so it doesn't pick up --text/--accent automatically the way
  // the rest of the app's chrome does via CSS variables. Reading them here keeps the shell text
  // legible in both themes instead of xterm's white-on-transparent default, which is invisible
  // against the light theme's --sidebar background (see the bug this fixed).
  function readXtermTheme() {
    const style = getComputedStyle(document.documentElement)
    const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback
    return {
      // Matches .terminal-dock's own --sidebar fill, so the shell text sits on the panel surface.
      // Set explicitly rather than left transparent: xterm's allowTransparency defaults to false,
      // and the surrounding viewport div is separately forced opaque black by xterm.css (see the
      // .terminal-xterm-host .xterm-viewport override in styles.css).
      background: v("--sidebar", "#202022"),
      foreground: v("--text", "#ededef"),
      cursor: v("--accent", "#00abeb"),
      cursorAccent: v("--sidebar", "#202022"),
      selectionBackground: v("--accent-soft-2", "rgba(0,171,235,.32)")
    }
  }

  onMount(() => {
    const term = new Terminal({
      convertEol: true,
      fontSize: 12.5,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: readXtermTheme()
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(host)
    fitAddon.fit()
    term.onData((data) => ctx.writeToTerminal(data))
    ctx.terminalBridge.write = (text) => term.write(text)
    // ResizeObserver fires per frame while the dock resizer is dragged, but fit() only changes
    // term.rows/cols when the drag crosses a whole cell boundary. Forwarding every fire turned one
    // drag into ~60 IPC round-trips per second, each an HTTP POST to the runtime; mirror fit()'s
    // own no-op and only report a size the pty hasn't been told yet. The memo is per-instance,
    // which is per-pty: TerminalPanel unmounts this component whenever the terminal closes, so a
    // newly opened pty always starts from -1 and gets its initial size reported.
    let sentRows = -1
    let sentCols = -1
    const resizeObserver = new ResizeObserver(() => {
      // The dock's island is `persistent` (see svelte/index.js), so while the dock is closed this
      // host sits in a detached container and measures 0. Fitting to that would resize the terminal
      // to a single row and reflow the buffer — exactly the scrollback loss the container prevents.
      if (!host.clientWidth || !host.clientHeight) return
      fitAddon.fit()
      if (term.rows === sentRows && term.cols === sentCols) return
      sentRows = term.rows
      sentCols = term.cols
      ctx.resizeTerminal(term.rows, term.cols)
    })
    resizeObserver.observe(host)
    // The theme toggle (setThemeMode) flips data-theme on <html> live, without a reload — keep
    // the terminal's colors in step with it while it's open.
    const themeObserver = new MutationObserver(() => { term.options.theme = readXtermTheme() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      ctx.terminalBridge.write = null
      term.dispose()
    }
  })
</script>

<div class="terminal-xterm-host" bind:this={host}></div>
