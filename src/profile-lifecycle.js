const PROFILE_STORAGE_CODES = new Set(["EACCES", "EPERM", "ENOSPC", "EROFS", "EIO", "ENOTDIR", "EISDIR"])

function errorChain(error) {
  const chain = []
  let current = error
  while (current && !chain.includes(current)) {
    chain.push(current)
    current = current.cause
  }
  return chain
}

function isProfileStorageError(error) {
  return errorChain(error).some((entry) =>
    Boolean(entry?.stage || entry?.invalidConfig || PROFILE_STORAGE_CODES.has(entry?.code))
  )
}

function blockedMessage(state) {
  return state.message || "The OpenWorking profile is unavailable. Fix the storage problem and retry."
}

class ProfileLifecycle {
  constructor({ profileDir, configPath, ensureProfile, onReady, onBlocked, emit }) {
    this.ensureProfile = ensureProfile
    this.onReady = onReady || (() => {})
    this.onBlocked = onBlocked || (() => {})
    this.emit = emit || (() => {})
    this.profile = null
    this.state = {
      status: "blocked",
      profileDir,
      configPath,
      stage: null,
      message: "The OpenWorking profile has not been initialized.",
      backupPath: null
    }
  }

  snapshot() {
    return { ...this.state }
  }

  publish() {
    const snapshot = this.snapshot()
    this.emit("profile:update", snapshot)
    return snapshot
  }

  initialize({ publish = false } = {}) {
    try {
      const profile = this.ensureProfile()
      this.profile = profile
      this.state = {
        status: profile.recovery ? "recovered" : "ready",
        profileDir: profile.profileDir,
        configPath: profile.configPath,
        stage: null,
        message: profile.recovery?.message || null,
        backupPath: profile.recovery?.backupPath || null
      }
      this.onReady(profile)
    } catch (error) {
      this.block(error, { publish: false })
    }
    return publish ? this.publish() : this.snapshot()
  }

  block(error, { publish = true } = {}) {
    this.profile = null
    this.state = {
      ...this.state,
      status: "blocked",
      stage: error?.stage || null,
      message: error?.message || "The OpenWorking profile is unavailable.",
      backupPath: null
    }
    this.onBlocked(error)
    return publish ? this.publish() : this.snapshot()
  }

  requireReady() {
    if (this.profile && (this.state.status === "ready" || this.state.status === "recovered")) {
      return this.profile
    }
    const error = new Error(blockedMessage(this.state))
    error.code = "PROFILE_BLOCKED"
    throw error
  }
}

module.exports = { PROFILE_STORAGE_CODES, ProfileLifecycle, isProfileStorageError }
