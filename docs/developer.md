# Development environment and builds

Kimaier is a pure Flutter application. It does not require a separate native
library or an additional Rust build.

## Installing Flutter

Install the current stable release from the
[Flutter SDK archive](https://docs.flutter.dev/install/archive), or clone it:

    git clone --branch stable https://github.com/flutter/flutter.git ~/development/flutter
    echo 'export PATH="$HOME/development/flutter/bin:$PATH"' >> ~/.zshenv
    exec zsh

Verify the installation and fetch the project dependencies:

    flutter doctor -v
    flutter devices
    flutter pub get
    flutter analyze

Flutter builds Linux applications on Linux, Windows applications on Windows,
and macOS and iOS applications on macOS. See the
[official platform overview](https://docs.flutter.dev/platform-integration).

## Linux on Fedora

    sudo dnf install clang cmake ninja-build pkgconf-pkg-config gtk3-devel \
      libstdc++-devel mesa-libGLU curl git unzip xz zip
    flutter doctor -v
    flutter run -d linux

Create a release build:

    flutter build linux --release

The complete distributable bundle is located at
`build/linux/x64/release/bundle/`. The `x64` directory can differ on other
architectures.

## Windows

Install Flutter and Visual Studio with the **Desktop development with C++**
workload. Verify the setup with `flutter doctor -v`.

    flutter pub get
    flutter run -d windows
    flutter build windows --release

The release is usually located at `build\windows\x64\runner\Release\`.
Distribute the complete directory, including the executable, DLLs, and the
`data/` directory. See
[Flutter Windows setup](https://docs.flutter.dev/platform-integration/windows/setup).

## macOS

Install Xcode and configure its command-line tools:

    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    sudo xcodebuild -runFirstLaunch
    flutter doctor -v
    flutter run -d macos
    flutter build macos --release

The application is located at
`build/macos/Build/Products/Release/kimaier.app`. Distribution requires
signing with an Apple certificate and notarization. Open
`macos/Runner.xcworkspace` in Xcode to configure these settings. See
[Building Flutter apps for macOS](https://docs.flutter.dev/platform-integration/macos/building).

## iOS

iOS builds require macOS and Xcode:

    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    sudo xcodebuild -runFirstLaunch
    xcodebuild -downloadPlatform iOS
    flutter doctor -v
    open -a Simulator
    flutter run

Create a release:

    flutter build ipa --release

Configure the team, bundle identifier, and signing in the Runner target of
`ios/Runner.xcworkspace`. Testing on a local device works with a free Apple
Developer account; App Store distribution requires a membership. See
[Flutter iOS setup](https://docs.flutter.dev/platform-integration/ios/setup).

## Checks before committing

    dart format --output=none --set-exit-if-changed lib
    flutter analyze
    flutter test
    git diff --check

Commit `pubspec.lock` to the repository. Generated directories such as
`.dart_tool/` and `build/` remain excluded through `.gitignore`.
