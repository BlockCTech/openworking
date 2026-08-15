# Windows build and release

## Targets

The Windows distribution uses per-user NSIS installers:

```text
OpenWorking-<version>-x64.exe
OpenWorking-<version>-arm64.exe
```

Each package contains exactly one matching `opencode-windows-<arch>` runtime.
`scripts/before-pack.js` fetches a missing optional runtime package with `npm
pack`, isolates the other architecture while electron-builder walks
`node_modules`, and restores the tree when the pack finishes.

## Local validation

Run these commands on the matching Windows architecture:

```sh
npm ci
npm test
npm run smoke:packaged:win -- --arch=x64
npm run dist:win:unsigned -- --x64
npm run smoke:installer:win -- --arch=x64
```

Replace `x64` with `arm64` on Windows ARM64. The packaged smoke verifies PE
machine headers, resources, skills, schemas and document-tool assets. The
installer smoke verifies fresh install, silent upgrade, app launch and uninstall;
it also checks that `userData` survives because uninstall must not delete sessions
or profile state.

## CI and signed release

`.github/workflows/windows.yml` runs unit tests and unsigned packaged smoke on the
x64 and ARM64 runner matrix. `.github/workflows/release-windows.yml` runs only on
a matching version tag or an approved manual dispatch. It builds one architecture
per job, signs every executable through Azure Trusted Signing, verifies the final
NSIS signature, creates SHA-256 sidecars, and publishes the artifacts.

Configure the `windows-production` GitHub Environment with these secrets/variables:

```text
AZURE_TENANT_ID
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
AZURE_TRUSTED_SIGNING_ENDPOINT
AZURE_TRUSTED_SIGNING_ACCOUNT
AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
WINDOWS_PUBLISHER_NAME
```

The Azure identity must have permission to sign with the selected Trusted Signing
account and certificate profile. `WINDOWS_PUBLISHER_NAME` must exactly match the
certificate publisher name; the signed app metadata embeds it so the running app
can verify downloaded installers before launching them.

## Update distribution

The existing version API contract is reused. For `platform=windows`, publish the
ARM64 installer at `download_url` and the x64 installer at `download_url_intel`.
The app selects the URL using its architecture, downloads only HTTPS payloads,
checks Authenticode and publisher on Windows, then launches NSIS silently after
quitting. If verification fails, the installer remains on disk and is revealed for
manual inspection instead of being executed.

The website should map the two URLs to the “x64 Installer” and “ARM64 Installer”
buttons. Keep the previous signed artifacts available until the version record has
been rolled back or all clients have moved to the new release.

## Platform limitations

The browser native-messaging integration and named IDE shortcuts remain macOS-only
and report an explicit unsupported state on Windows. Opening a project with
“System” continues to use Electron's OS-default folder handler.
