const { execFileSync } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const { verifyWindowsInstaller } = require("../src/version-check")
const { windowsAwareCommand } = require("./windows-command")

const root = path.join(__dirname, "..")
const bumpLevels = ["patch", "minor", "major"]
const signingEnvNames = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE",
  "WINDOWS_PUBLISHER_NAME"
]

function validateWindowsReleaseEnvironment(env = process.env, platform = process.platform) {
  if (platform !== "win32") {
    throw new Error("Signed Windows releases must be built on Windows.")
  }
  const missing = signingEnvNames.filter((name) => !env[name])
  if (missing.length) {
    throw new Error(`Missing Windows release signing environment variables: ${missing.join(", ")}`)
  }
}

function parseOptions(argv = []) {
  const bump = argv.find((arg) => bumpLevels.includes(arg)) || "patch"
  const archOption = argv.find((arg) => arg.startsWith("--arch="))
  const arch = archOption ? archOption.slice("--arch=".length) : null
  if (arch && arch !== "x64" && arch !== "arm64") {
    throw new Error(`Unsupported Windows release arch "${arch}". Use x64 or arm64.`)
  }
  return { bump, arch, shouldBump: !argv.includes("--no-bump") }
}

function signedBuildArgs(env, arch) {
  return [
    "--win",
    "nsis",
    ...(arch ? [`--${arch}`] : []),
    "-c.win.forceCodeSigning=true",
    `-c.win.azureSignOptions.endpoint=${env.AZURE_TRUSTED_SIGNING_ENDPOINT}`,
    `-c.win.azureSignOptions.codeSigningAccountName=${env.AZURE_TRUSTED_SIGNING_ACCOUNT}`,
    `-c.win.azureSignOptions.certificateProfileName=${env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE}`,
    `-c.win.azureSignOptions.publisherName=${env.WINDOWS_PUBLISHER_NAME}`,
    "-c.win.azureSignOptions.fileDigest=SHA256",
    "-c.win.azureSignOptions.timestampDigest=SHA256",
    `-c.extraMetadata.windowsPublisherName=${env.WINDOWS_PUBLISHER_NAME}`
  ]
}

function artifactNames(version, arch = null) {
  const arches = arch ? [arch] : ["x64", "arm64"]
  return arches.map((item) => `OpenWorking-${version}-${item}.exe`)
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
}

function writeChecksum(filePath) {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
  const checksumPath = `${filePath}.sha256`
  fs.writeFileSync(checksumPath, `${digest} *${path.basename(filePath)}\n`)
  return checksumPath
}

function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseOptions(argv)
  validateWindowsReleaseEnvironment(env)

  if (options.shouldBump) {
    execFileSync(...windowsAwareCommand("npm", ["version", options.bump, "--no-git-tag-version"]), {
      cwd: root,
      stdio: "inherit"
    })
  }

  const version = readVersion()
  // Via cmd.exe /c, never shell:true — signedBuildArgs embeds the publisher name, which contains
  // spaces, and shell:true would concatenate argv unescaped (Node DEP0190) and re-split it.
  execFileSync(
    ...windowsAwareCommand(path.join(root, "node_modules", ".bin", "electron-builder"), signedBuildArgs(env, options.arch)),
    {
      cwd: root,
      env,
      stdio: "inherit"
    }
  )

  const artifacts = artifactNames(version, options.arch).map((name) => path.join(root, "dist", name))
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact)) throw new Error(`Expected Windows installer was not found: ${artifact}`)
    verifyWindowsInstaller({
      installerPath: artifact,
      publisherName: env.WINDOWS_PUBLISHER_NAME,
      platform: "win32"
    })
    writeChecksum(artifact)
  }

  console.log(`Released OpenWorking ${version} for ${options.arch || "x64 and arm64"}.`)
  for (const artifact of artifacts) console.log(`  ${path.relative(root, artifact)}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

module.exports = {
  artifactNames,
  parseOptions,
  signedBuildArgs,
  validateWindowsReleaseEnvironment,
  writeChecksum
}
