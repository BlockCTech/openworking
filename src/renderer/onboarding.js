// First-run guided tour, extracted from renderer.js: the step data, the persistence flag, the
// start/advance/finish/skip behavior, and the overlay/demo/position renderers. Reads shared `state`
// and calls back into `render` + a few util helpers, all injected via init(). Exposed on
// window.OpenWorkingOnboarding. Behavior is unchanged — this is a straight move.
(function exposeOnboarding(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingOnboarding = api
})(typeof window === "object" ? window : globalThis, function createOnboarding() {
  // Injected via init(): { state, render, icon, escapeHtml, REASONING_OPTIONS }.
  let ctx = {}

  // One-shot flag: "1" once the first-run onboarding tour has been completed or skipped.
  const ONBOARDING_KEY = "openworking:onboarding-done"

  // First-run guided tour. Step 0 is a centered welcome card. Steps 1–2 spotlight a REAL element in
  // the sidebar (Add project / New session). Steps 3–5 (Plan / Execution / Reasoning) render a
  // self-contained DEMO composer inside the overlay and spotlight a control INSIDE it — this way the
  // chat controls always have something to point at even before the user has a project, so the tour
  // never falls onto an empty screen. Step 6 navigates to the real Skills screen and spotlights the
  // real "Upload skill" button.
  //
  // Step fields:
  //   center            → centered card, no spotlight (welcome step)
  //   anchor/fallbackAnchor → CSS selector(s) of the real element to spotlight
  //   nav               → switch the app to this screen before rendering (e.g. "skills")
  //   demo:"composer"   → render the demo composer panel; anchor points at a `.demo-*` control in it
  //   demoPlanOn        → demo composer shows Plan (true) vs Execution (false) mode
  //   demoOpenPopover   → demo composer pre-opens this popover ("plus" | "reasoning")
  const ONBOARDING_STEPS = [
    {
      title: "Welcome to OpenWorking",
      body: "Let's take 30 seconds to see how to get work done locally. You can skip anytime.",
      center: true
    },
    {
      title: "Add a local project",
      body: "Point OpenWorking at any folder on your machine. Everything runs locally inside it.",
      anchor: '.sl-act[data-action="addProject"]',
      fallbackAnchor: '.empty-state [data-action="addProject"]'
    },
    {
      title: "Start a new session",
      body: "Each session is a fresh conversation scoped to a project. Here's what the chat looks like.",
      anchor: '.new-session[data-action="newSession"]'
    },
    {
      title: "Plan mode",
      body: "In a chat, turn on Plan mode and the assistant reads only, then proposes a plan before touching files.",
      demo: "composer",
      demoPlanOn: true,
      demoOpenPopover: "plus",
      anchor: ".onboarding-demo .demo-plan-toggle"
    },
    {
      title: "Execution mode",
      body: "With Plan mode off you're in Execution mode — the assistant reads and edits files directly.",
      demo: "composer",
      demoPlanOn: false,
      anchor: ".onboarding-demo .demo-mode-label"
    },
    {
      title: "Reasoning effort",
      body: "Dial reasoning from None to Extra High. Higher effort is more thorough but slower and uses limits faster.",
      demo: "composer",
      demoPlanOn: false,
      demoOpenPopover: "reasoning",
      anchor: ".onboarding-demo .demo-reasoning"
    },
    {
      title: "Upload a skill",
      body: "On the Skills screen, add your own packaged skill here, or browse the catalog of ready-made ones.",
      nav: "skills",
      anchor: '.btn-up[data-action="openSkillUpload"]'
    }
  ]

  const ONBOARDING_LAST_STEP = ONBOARDING_STEPS.length - 1
  const ONBOARDING_CARD_GAP = 14
  const ONBOARDING_SPOTLIGHT_PAD = 6

  function hasSeenOnboarding() {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "1"
    } catch (error) {
      return false
    }
  }

  function markOnboardingSeen() {
    try {
      localStorage.setItem(ONBOARDING_KEY, "1")
    } catch (error) {
      // Best-effort — persistence failure just means the tour may reappear later.
    }
  }

  // Prepare the app so the step's anchor is visible before we render/measure it. Chat-control steps
  // use a self-contained demo composer (no real popover state touched), so here we only handle screen
  // navigation: steps with `nav` switch screens (e.g. Skills), other steps restore the screen the
  // user was on when the tour started so leaving the Skills step never strands them there.
  function prepareOnboardingStep(index) {
    const { state } = ctx
    const step = ONBOARDING_STEPS[index]
    if (step?.nav === "skills") {
      state.nav = "skills"
      state.skillsTab = "skills"
    } else if (state.onboarding && state.nav === "skills") {
      // Leaving the Skills step → go back to wherever the user was before the tour.
      state.nav = state.onboarding.returnNav || "session"
    }
  }

  function startOnboarding({ replay = false } = {}) {
    const { state, render } = ctx
    // Never overlay the first-run tour on top of a blocking force-update modal. Replay is user-
    // initiated from Settings, where no force modal can be showing, so it isn't gated.
    if (!replay && state.versionGate?.status === "force") return
    state.onboarding = { step: 0, returnNav: state.nav }
    prepareOnboardingStep(0)
    render()
  }

  function advanceOnboarding(delta) {
    const { state, render } = ctx
    if (!state.onboarding) return
    const next = state.onboarding.step + delta
    if (next < 0) return
    if (next > ONBOARDING_LAST_STEP) {
      finishOnboarding()
      return
    }
    const returnNav = state.onboarding.returnNav
    state.onboarding = { step: next, returnNav }
    prepareOnboardingStep(next)
    render()
  }

  function finishOnboarding() {
    const { state, render } = ctx
    markOnboardingSeen()
    // Restore the pre-tour screen so closing the tour on the Skills step doesn't strand the user.
    if (state.onboarding?.returnNav) state.nav = state.onboarding.returnNav
    state.onboarding = null
    render()
  }

  function skipOnboarding() {
    finishOnboarding()
  }

  // Renders the first-run tour overlay. The spotlight/card are absolutely positioned after render
  // by positionOnboarding() once the anchor's bounding box is known, so here we emit them with no
  // geometry and let that pass fill it in. Step 0 (and any step whose anchor is missing) shows a
  // centered card with no spotlight.
  function renderOnboarding() {
    const { state, icon, escapeHtml } = ctx
    if (!state.onboarding) return ""
    const index = Math.min(Math.max(state.onboarding.step, 0), ONBOARDING_LAST_STEP)
    const step = ONBOARDING_STEPS[index]
    const isFirst = index === 0
    const isLast = index === ONBOARDING_LAST_STEP
    const dots = ONBOARDING_STEPS.map((_, i) =>
      `<span class="onboarding-dot ${i === index ? "active" : ""}"></span>`
    ).join("")
    const mark = step.center ? `<div class="onboarding-mark">${icon("blocks")}</div>` : ""
    const backBtn = isFirst
      ? ""
      : `<button class="onboarding-btn ghost" data-action="onboardingBack">Back</button>`
    const nextLabel = isFirst ? "Take the tour" : isLast ? "Done" : "Next"
    const nextAction = isLast ? "onboardingDone" : "onboardingNext"
    const demo = step.demo === "composer" ? renderOnboardingDemo(step) : ""
    return `
    <div class="onboarding-backdrop" data-onboarding-root>
      ${demo}
      <div class="onboarding-spotlight" data-onboarding-spotlight hidden></div>
      <div class="onboarding-card ${step.center ? "center" : ""}" data-onboarding-card data-stop-click>
        ${mark}
        <div class="onboarding-progress">
          <span class="onboarding-step-label">Step ${index} of ${ONBOARDING_LAST_STEP}</span>
          <span class="onboarding-dots">${dots}</span>
        </div>
        <h2>${escapeHtml(step.title)}</h2>
        <p>${escapeHtml(step.body)}</p>
        <div class="onboarding-actions">
          <button class="onboarding-skip" data-action="onboardingSkip">${isLast ? "" : "Skip"}</button>
          <div class="onboarding-nav">
            ${backBtn}
            <button class="onboarding-btn primary" data-action="${nextAction}">${nextLabel}</button>
          </div>
        </div>
      </div>
    </div>
  `
  }

  // A non-interactive, full-size replica of a real chat session (thread + docked composer), shown
  // during the chat steps of the tour (Plan / Execution / Reasoning). It reuses the REAL layout
  // classes (.thread-scroll / .thread-inner / .composer-dock / .composer / .composer-bar) so it is
  // pixel-identical to an actual session — same 1440px max-width, same gutters — and is sized by
  // positionOnboarding() to overlay the live `.main` region exactly. It carries no data-action /
  // data-popover (nothing here touches app state) and is pointer-events:none. Anchor classes
  // (.demo-plan-toggle / .demo-mode-label / .demo-reasoning) let positionOnboarding() spotlight the
  // exact control the step teaches. Plan vs Execution and which popover is open are driven purely by
  // the step, never by state.mode / state.popover.
  function renderOnboardingDemo(step) {
    const { icon, escapeHtml, REASONING_OPTIONS } = ctx
    const planOn = !!step.demoPlanOn
    const openPlus = step.demoOpenPopover === "plus"
    const openReasoning = step.demoOpenPopover === "reasoning"
    const plusPop = openPlus
      ? `<div class="pop pop-up plus-pop">
         <button class="pop-item">${icon("attach")}<span><strong>Add photos &amp; files</strong></span></button>
         <div class="pop-divider"></div>
         <button class="pop-toggle demo-plan-toggle ${planOn ? "on" : ""}" aria-pressed="${planOn}">
           ${icon("ask")}<span>Plan mode</span><span class="switch ${planOn ? "on" : ""}"></span>
         </button>
       </div>`
      : ""
    const reasoningPop = openReasoning
      ? `<div class="pop pop-up reasoning-pop">
         <div class="reasoning-pop-head"><span>Effort</span><strong>High</strong></div>
         <div class="reasoning-pop-scale-labels"><span>Faster</span><span>Smarter</span></div>
         <div class="reasoning-scale">
           ${REASONING_OPTIONS.map((option) => `
             <button class="reasoning-option ${option.id === "high" ? "active" : ""}">
               <span class="reasoning-dot"></span><span>${escapeHtml(option.shortLabel)}</span>
             </button>`).join("")}
         </div>
       </div>`
      : ""
    return `
    <div class="onboarding-demo" data-onboarding-demo aria-hidden="true">
      <div class="main-head">
        <div class="head-copy"><div class="head-title">Add pagination to projects</div></div>
      </div>
      <div class="thread-scroll">
        <div class="thread-inner">
          <div class="msg-user"><div class="message-stack user-message"><div class="message-card bubble">
            <div>Add pagination to the projects list endpoint.</div>
          </div></div></div>
          <div class="msg-ai"><div class="message-stack assistant-message"><div class="message-card ai-body">
            <div class="assistant-text">Sure — here's how I'd approach it. First I'll read the router to see how the list is built, then add <code>limit</code>/<code>offset</code> query params with sensible defaults, and return the total count so the client can paginate.</div>
          </div></div></div>
        </div>
      </div>
      <div class="composer-dock">
        <div class="composer">
          <div class="ta-wrap">
            <div class="prompt-editor" data-placeholder="Reply to this session…"></div>
          </div>
          <div class="composer-bar">
            <div class="popover-anchor">
              <button class="icon-btn">${icon("plus")}</button>
              ${plusPop}
            </div>
            <span class="mode-label demo-mode-label ${planOn ? "plan" : ""}">${planOn ? "Plan" : "Execution"}</span>
            <span class="spacer"></span>
            <span class="model-label">Gemma 4-31B</span>
            <div class="popover-anchor">
              <button class="reasoning-control demo-reasoning ${openReasoning ? "on" : ""}">
                <span>${openReasoning ? "High" : "None"}</span>${icon("chevDown")}
              </button>
              ${reasoningPop}
            </div>
            <button class="send disabled">${icon("arrowUp")}</button>
          </div>
        </div>
      </div>
    </div>
  `
  }

  // Measures the current step's anchor and positions the spotlight + card around it. Falls back to
  // a centered card (no spotlight) when the step is a welcome card or the anchor isn't on screen.
  function positionOnboarding() {
    const { state } = ctx
    if (!state.onboarding) return
    const root = document.querySelector("[data-onboarding-root]")
    if (!root) return
    const spotlight = root.querySelector("[data-onboarding-spotlight]")
    const card = root.querySelector("[data-onboarding-card]")
    if (!spotlight || !card) return

    const index = Math.min(Math.max(state.onboarding.step, 0), ONBOARDING_LAST_STEP)
    const step = ONBOARDING_STEPS[index]

    // Demo steps: overlay the demo session exactly onto the live `.main` content region so it fills
    // the same area a real chat would (identical width/gutters), then measure the anchor inside it.
    const demo = root.querySelector("[data-onboarding-demo]")
    if (demo) {
      const main = document.querySelector(".main")
      if (main) {
        const mr = main.getBoundingClientRect()
        demo.style.left = `${mr.left}px`
        demo.style.top = `${mr.top}px`
        demo.style.width = `${mr.width}px`
        demo.style.height = `${mr.height}px`
      }
    }

    const anchorSelector = step.center ? null : step.anchor
    const anchor = anchorSelector
      ? document.querySelector(anchorSelector) || (step.fallbackAnchor ? document.querySelector(step.fallbackAnchor) : null)
      : null

    // No anchor (welcome step or element not rendered) → center the card, hide the spotlight.
    if (!anchor) {
      spotlight.hidden = true
      card.classList.add("center")
      card.style.left = ""
      card.style.top = ""
      return
    }

    const rect = anchor.getBoundingClientRect()
    // Element exists but has no layout box (hidden/detached) → treat as missing.
    if (rect.width === 0 && rect.height === 0) {
      spotlight.hidden = true
      card.classList.add("center")
      card.style.left = ""
      card.style.top = ""
      return
    }

    // For demo steps the anchor control has an open popover (Plan toggle / reasoning menu) that
    // should be highlighted too and, crucially, not covered by the card. Union the anchor rect with
    // the demo popover's rect so the spotlight frames both and the card-avoidance below steers clear.
    let regionLeft = rect.left
    let regionTop = rect.top
    let regionRight = rect.right
    let regionBottom = rect.bottom
    if (demo) {
      const pop = demo.querySelector(".pop")
      const popRect = pop ? pop.getBoundingClientRect() : null
      if (popRect && (popRect.width || popRect.height)) {
        regionLeft = Math.min(regionLeft, popRect.left)
        regionTop = Math.min(regionTop, popRect.top)
        regionRight = Math.max(regionRight, popRect.right)
        regionBottom = Math.max(regionBottom, popRect.bottom)
      }
    }

    const pad = ONBOARDING_SPOTLIGHT_PAD
    const sx = regionLeft - pad
    const sy = regionTop - pad
    const sw = (regionRight - regionLeft) + pad * 2
    const sh = (regionBottom - regionTop) + pad * 2
    spotlight.hidden = false
    spotlight.style.left = `${sx}px`
    spotlight.style.top = `${sy}px`
    spotlight.style.width = `${sw}px`
    spotlight.style.height = `${sh}px`

    card.classList.remove("center")
    const cardRect = card.getBoundingClientRect()
    const cardW = cardRect.width
    const cardH = cardRect.height
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 12

    // Prefer placing the card below the spotlight, then above, then to the right, then left.
    let top = sy + sh + ONBOARDING_CARD_GAP
    if (top + cardH + margin > vh) top = sy - cardH - ONBOARDING_CARD_GAP
    let placeVertical = true
    if (top < margin) {
      // Not enough room above or below → place beside the spotlight instead.
      placeVertical = false
      top = sy + sh / 2 - cardH / 2
    }

    let left
    if (placeVertical) {
      // Align the card's left edge near the spotlight, clamped into the viewport.
      left = sx + sw / 2 - cardW / 2
    } else {
      left = sx + sw + ONBOARDING_CARD_GAP
      if (left + cardW + margin > vw) left = sx - cardW - ONBOARDING_CARD_GAP
    }

    left = Math.max(margin, Math.min(left, vw - cardW - margin))
    top = Math.max(margin, Math.min(top, vh - cardH - margin))
    card.style.left = `${left}px`
    card.style.top = `${top}px`
  }

  return {
    init(deps) { ctx = deps || {} },
    ONBOARDING_STEPS,
    ONBOARDING_LAST_STEP,
    hasSeenOnboarding,
    markOnboardingSeen,
    prepareOnboardingStep,
    startOnboarding,
    advanceOnboarding,
    finishOnboarding,
    skipOnboarding,
    renderOnboarding,
    renderOnboardingDemo,
    positionOnboarding
  }
})
