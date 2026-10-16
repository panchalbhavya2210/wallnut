# Installs the Android SDK packages Wallnut needs, accepting licences.
#
#   powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
#
# Expects the command-line tools at <toolchain>\android-sdk\cmdline-tools\latest.

$ErrorActionPreference = 'Stop'

$toolchain = Join-Path $env:USERPROFILE '.toolchain'
$sdk = 'C:\Android\Sdk'
$jdk = Get-ChildItem -Path $toolchain -Directory -Filter '*jdk*' | Select-Object -First 1
if (-not $jdk) { throw "JDK not found in $toolchain" }
if (-not (Test-Path $sdk)) { throw "Android SDK not found at $sdk" }

$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

$sdkmanager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) { throw "sdkmanager not found at $sdkmanager" }

Write-Host 'Accepting SDK licences?'
# sdkmanager asks y/N per licence; feed it a stream of y.
$answers = ("y`n" * 40)
$answers | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null

Write-Host 'Installing platform-tools, platform 36 and build-tools 36?'
& $sdkmanager --sdk_root=$sdk 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'

Write-Host "`nInstalled packages:"
Get-ChildItem $sdk | Select-Object -ExpandProperty Name
