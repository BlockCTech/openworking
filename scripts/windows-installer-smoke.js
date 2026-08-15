const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.join(__dirname, "..")
const productName = "OpenWorking"

function run(executable, args = [], env = process.env) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} exited with status ${result.status ?? "unknown"}`)
  }
}

function findUninstaller(installDir, fileSystem = fs) {
  return fileSystem.readdirSync(installDir)
    .find((name) => /^Uninstall .*\.exe$/i.test(name))
}

function requireUninstaller(installDir, fileSystem = fs) {
  const name = findUninstaller(installDir, fileSystem)
  if (!name) throw new Error(`NSIS uninstaller was not found in ${installDir}`)
  return path.join(installDir, name)
}

function main(argv = process.argv.slice(2)) {
  if (process.platform !== "win32") throw new Error("Windows installer smoke must run on Windows.")
  const archArg = argv.find((arg) => arg.startsWith("--arch="))
  const arch = archArg ? archArg.slice("--arch=".length) : process.arch
  if (arch !== process.arch) throw new Error(`Installer smoke requires native ${arch} Windows (current: ${process.arch}).`)

  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
  const installer = path.join(root, "dist", `${productName}-${version}-${arch}.exe`)
  if (!fs.existsSync(installer)) throw new Error(`Installer was not found: ${installer}`)

  const localAppData = process.env.LOCALAPPDATA
  const appData = process.env.APPDATA
  if (!localAppData || !appData) throw new Error("LOCALAPPDATA and APPDATA are required.")
  const installDir = path.join(localAppData, "Programs", productName)
  const desktopBin = path.join(installDir, `${productName}.exe`)
  const stableUserData = path.join(appData, productName)
  const marker = path.join(stableUserData, "windows-installer-smoke.marker")

  fs.mkdirSync(stableUserData, { recursive: true })
  fs.writeFileSync(marker, `${Date.now()}\n`)

  let installed = false
  try {
    run(installer, ["/S"])
    installed = fs.existsSync(desktopBin)
    if (!installed) throw new Error(`Installed executable was not found: ${desktopBin}`)

    // A second install exercises the NSIS upgrade path. Stable user data must
    // survive both the upgrade and the later uninstall.
    run(installer, ["/S"])
    if (!fs.existsSync(marker)) throw new Error("NSIS upgrade removed the stable userData marker.")

    run(process.execPath, [path.join(__dirname, "electron-smoke.js")], {
      ...process.env,
      OPENWORKING_DESKTOP_BIN: desktopBin,
      PATH: [
        path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
        process.env.SystemRoot || "C:\\Windows"
      ].join(path.delimiter)
    })
  } finally {
    if (installed) {
      if (!fs.existsSync(installDir)) throw new Error(`Install directory disappeared before uninstall: ${installDir}`)
      run(requireUninstaller(installDir), ["/S"])
      if (fs.existsSync(desktopBin)) throw new Error(`Uninstall left the installed executable behind: ${desktopBin}`)
    }
  }

  if (!fs.existsSync(marker)) throw new Error("Uninstall removed stable userData even though deleteAppDataOnUninstall is false.")
  fs.rmSync(marker, { force: true })
  console.log(`windows installer smoke passed (${arch})`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

module.exports = { findUninstaller, requireUninstaller }
