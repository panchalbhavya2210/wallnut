# Generates the Wallnut icon/splash asset set from assets/brand-source.png.
#
#   powershell -ExecutionPolicy Bypass -File scripts/generate-assets.ps1
#
# Uses System.Drawing (ships with Windows PowerShell) so no image libraries are
# needed. The source art is black-on-white: the script keeps it as-is for the
# app icon, and derives transparency/ink variants for adaptive icons, the dark
# splash and in-app marks (alpha = darkness, so anti-aliasing is preserved).
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'assets\brand-source.png'
$out = Join-Path $root 'assets\images'

if (-not (Test-Path $source)) {
  Write-Error 'Missing brand-source.png - put the brand PNG in assets first.'
  exit 1
}
New-Item -ItemType Directory -Force -Path $out | Out-Null

$src = [System.Drawing.Image]::FromFile($source)
Write-Host ('Source: ' + $src.Width + 'x' + $src.Height)

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$name) {
  $path = Join-Path $out $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $dims = [string]$bitmap.Width + 'x' + [string]$bitmap.Height
  Write-Host ('  wrote ' + $name + ' (' + $dims + ')')
}

function New-Canvas([int]$size, [System.Drawing.Color]$background) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear($background)
  return @($bitmap, $graphics)
}

function Draw-Scaled([System.Drawing.Graphics]$graphics, [System.Drawing.Image]$image, [int]$canvas, [double]$fraction) {
  $w = [int]($canvas * $fraction)
  $x = [int](($canvas - $w) / 2)
  $rect = New-Object System.Drawing.Rectangle($x, $x, $w, $w)
  $graphics.DrawImage($image, $rect)
}

# Renders the mark scaled onto a white canvas, then converts darkness to alpha
# in the requested ink colour (black or white) via LockBits for speed.
function New-Mark([int]$size, [System.Drawing.Color]$ink, [double]$fraction) {
  $pair = New-Canvas $size ([System.Drawing.Color]::White)
  $bitmap = $pair[0]
  $graphics = $pair[1]
  Draw-Scaled $graphics $src $size $fraction
  $graphics.Dispose()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = $data.Stride * $size
  $buffer = New-Object byte[] $bytes
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buffer, 0, $bytes)

  for ($i = 0; $i -lt $bytes; $i += 4) {
    $b = [int]$buffer[$i]
    $g = [int]$buffer[$i + 1]
    $r = [int]$buffer[$i + 2]
    $luminance = 0.299 * $r + 0.587 * $g + 0.114 * $b
    $alpha = [int](255 - $luminance)
    if ($alpha -lt 0) { $alpha = 0 }
    if ($alpha -gt 255) { $alpha = 255 }
    $buffer[$i] = $ink.B
    $buffer[$i + 1] = $ink.G
    $buffer[$i + 2] = $ink.R
    $buffer[$i + 3] = $alpha
  }
  [System.Runtime.InteropServices.Marshal]::Copy($buffer, 0, $data.Scan0, $bytes)
  $bitmap.UnlockBits($data)
  return $bitmap
}

Write-Host 'Generatingâ€¦'

# 1. App icon: the supplied art, full bleed on white.
$pair = New-Canvas 1024 ([System.Drawing.Color]::White)
Draw-Scaled $pair[1] $src 1024 1.0
$pair[1].Dispose()
Save-Png $pair[0] 'icon.png'
$pair[0].Dispose()

# 2. Android adaptive foreground + monochrome (black ink, safe-zone scale).
$mark = New-Mark 1024 ([System.Drawing.Color]::FromArgb(255, 0, 0, 0)) 0.58
Save-Png $mark 'android-icon-foreground.png'
$mono = New-Mark 1024 ([System.Drawing.Color]::FromArgb(255, 0, 0, 0)) 0.58
Save-Png $mono 'android-icon-monochrome.png'
$mark.Dispose(); $mono.Dispose()

# 3. Splash marks: black on the light splash, white on the dark splash.
$splashLight = New-Mark 512 ([System.Drawing.Color]::FromArgb(255, 0, 0, 0)) 0.82
Save-Png $splashLight 'splash-icon.png'
$splashLight.Dispose()
$splashDark = New-Mark 512 ([System.Drawing.Color]::FromArgb(255, 255, 255, 255)) 0.82
Save-Png $splashDark 'splash-icon-dark.png'
$splashDark.Dispose()

# 4. In-app marks for the boot screen and drawer header.
$logoDark = New-Mark 160 ([System.Drawing.Color]::FromArgb(255, 255, 255, 255)) 0.92
Save-Png $logoDark 'logo-mark-dark.png'
$logoDark.Dispose()
$logoLight = New-Mark 160 ([System.Drawing.Color]::FromArgb(255, 0, 0, 0)) 0.92
Save-Png $logoLight 'logo-mark-light.png'
$logoLight.Dispose()

# 5. Web favicon from the icon.
$pair = New-Canvas 64 ([System.Drawing.Color]::White)
Draw-Scaled $pair[1] $src 64 1.0
$pair[1].Dispose()
Save-Png $pair[0] 'favicon.png'
$pair[0].Dispose()

$src.Dispose()
Write-Host 'Done.'
