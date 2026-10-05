# Homebrew cask for the macOS port of Edge-Drop.
#
# This file is a template for a personal tap (for example
# SVorobiev-ru/homebrew-tap, file Casks/edge-drop.rb). The version and the two
# sha256 values are filled in by scripts/update-cask.sh after a release.
cask "edge-drop" do
  arch arm: "arm64", intel: "x64"

  version "0.0.0-mac.0"
  sha256 arm:   "REPLACE_WITH_ARM64_SHA256",
         intel: "REPLACE_WITH_X64_SHA256"

  url "https://github.com/SVorobiev-ru/Edge-Drop/releases/download/v#{version}/Edge-Drop-#{version}-mac-#{arch}.dmg"
  name "Edge-Drop"
  desc "Clipboard shelf that lives at the screen edge"
  homepage "https://github.com/SVorobiev-ru/Edge-Drop"

  livecheck do
    url :url
    regex(/^v?(\d+(?:\.\d+)+-mac\.\d+)$/i)
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Edge-Drop.app"

  uninstall quit: "com.edgedrop.app"

  zap trash: [
    "~/Library/Application Support/edge-drop",
    "~/Library/Preferences/com.edgedrop.app.plist",
    "~/Library/Saved Application State/com.edgedrop.app.savedState",
  ]

  caveats <<~EOS
    Edge-Drop has no Apple Developer ID and is not notarized. If macOS refuses
    to open it, remove the quarantine attribute:

      xattr -dr com.apple.quarantine /Applications/Edge-Drop.app

    Click-to-paste needs Accessibility access:
    System Settings → Privacy & Security → Accessibility.
  EOS
end
