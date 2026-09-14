# Kimaier

Kimaier is a small native Kimai time tracker. Its interface is built with
[Slint](https://slint.dev/); the application logic, HTTP client, and local
configuration are Rust. It builds for Windows, macOS, and Linux without a
WebView, Node.js, or a JavaScript runtime.

## Run it

```sh
cd src-tauri
cargo run
```

On first launch, enter the Kimai API URL and token, the project and activity
names, weekly hours, start date, and working days. Kimaier validates the
project/activity pair with Kimai before storing the settings in the operating
system's application configuration directory.

On Linux, the first run also reads the former Tauri store at
`~/.local/share/kimaier/kimaier.dat` when no Slint settings file exists. Saving
the settings writes them to the new native configuration location.

## Development and release builds

```sh
cd src-tauri
cargo check
cargo run --release
```

The native Slint layer contains no desktop-only business logic. Platform
integration is isolated from the Kimai client and settings model, so an iOS
frontend can reuse the same Rust core later. Desktop builds currently target
Windows, macOS, and Linux.
