# Wallnut APK build status.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-status.ps1
#
# Prints whether a build is running, how far it has got, and where the APK is.

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
# Always read the newest build log.
$log = Get-ChildItem $env:TEMP -Filter 'wallnut-build*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$apkDir = Join-Path $root 'android\app\build\outputs\apk\release'
$cache = Join-Path $env:USERPROFILE '.gradle\caches\modules-2\files-2.1'

function Line($text) { Write-Host $text }

Line ''
Line '  WALLNUT BUILD STATUS'
Line '  -------------------'

# 1. Is Gradle running?
$java = Get-Process java -ErrorAction SilentlyContinue
Line ("  Gradle/JVM processes : {0}" -f (($java | Measure-Object).Count))

# 2. Dependencies cached
if (Test-Path $cache) {
  $size = (Get-ChildItem $cache -Recurse -File | Measure-Object -Property Length -Sum).Sum
  Line ("  Dependencies cached  : {0} MB" -f [Math]::Round($size / 1MB, 1))
} else {
  Line '  Dependencies cached  : none yet'
}

# 3. NDK
$ndk = Join-Path $env:USERPROFILE '.toolchain\android-sdk\ndk\27.1.12297006'
if (Test-Path $ndk) {
  $ndkSize = (Get-ChildItem $ndk -Recurse -File | Measure-Object -Property Length -Sum).Sum
  Line ("  Android NDK          : installed ({0} MB)" -f [Math]::Round($ndkSize / 1MB, 0))
} else {
  Line '  Android NDK          : not installed'
}

# 4. Current phase from the log
if ($log) {
  $lines = Get-Content $log.FullName
  $tasks = $lines | Where-Object { $_ -match '^> Task ' }
  $failed = $lines | Where-Object { $_ -match 'FAILURE:|BUILD FAILED' }
  $lastTask = ($tasks | Select-Object -Last 1)

  Line ("  Log lines            : {0}" -f $lines.Count)
  Line ("  Gradle tasks so far  : {0}" -f $tasks.Count)
  Line ("  Log file             : {0}" -f (Split-Path $log -Leaf))
  if ($failed) {
    Line ''
    Line '  RESULT: BUILD FAILED'
    $lines | Select-Object -Last 25 | ForEach-Object { Line ("    $_") }
    exit 1
  }
  Line ''
  Line '  Latest Gradle tasks:'
  $tasks | Select-Object -Last 6 | ForEach-Object { Line ("    $_") }
} else {
  Line '  Log                  : no build started yet'
}
# 5. APK
$apk = Get-ChildItem $apkDir -Filter '*.apk' -File
$copied = Get-ChildItem $root -Filter 'wallnut-*.apk' -File
Line ''
if ($apk) {
  foreach ($file in $apk) { Line ("  APK                  : {0} ({1} MB)" -f $file.FullName, [Math]::Round($file.Length / 1MB, 1)) }
} else {
  Line '  APK                  : not built yet'
}
if ($copied) {
  foreach ($file in $copied) { Line ("  Ready to install     : {0} ({1} MB)" -f $file.FullName, [Math]::Round($file.Length / 1MB, 1)) }
  Line ''
  Line ("  Install: adb install -r `"{0}`"" -f $copied[0].FullName)
}
Line ''
