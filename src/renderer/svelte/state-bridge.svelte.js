// Reactive bridge between the legacy global `state` object (renderer.js, a classic script that
// cannot import modules) and Svelte 5 runes. bindStateBridge moves the listed fields into a
// $state backing store and re-exposes them on the legacy object via getter/setter properties,
// so legacy code keeps reading/writing `state.xxx` unchanged while Svelte components tracking
// those reads update fine-grained — no tick/paint needed for bridged fields.
//
// Set/Map values are wrapped in SvelteSet/SvelteMap (drop-in subclasses) so in-place mutations
// (`state.expanded.add(...)`) are reactive too; the setter re-wraps on reassignment
// (`state.expanded = new Set(...)`). Only UI-local fields may be bridged — $state proxies must
// never cross IPC/structured-clone boundaries (renderer.js keeps config/projects unbridged).
import { SvelteSet, SvelteMap } from "svelte/reactivity"

function wrapReactive(value) {
  if (value instanceof SvelteSet || value instanceof SvelteMap) return value
  if (value instanceof Set) return new SvelteSet(value)
  if (value instanceof Map) return new SvelteMap(value)
  return value
}

export function bindStateBridge(legacyState, fields) {
  const backing = $state({})
  for (const key of fields) {
    backing[key] = wrapReactive(legacyState[key])
    Object.defineProperty(legacyState, key, {
      get() { return backing[key] },
      set(value) { backing[key] = wrapReactive(value) },
      enumerable: true,
      configurable: true
    })
  }
  return backing
}
