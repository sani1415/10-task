$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-PwaIcon {
  param([int]$Size, [string]$OutPath)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::FromArgb(255, 7, 94, 84))
  $fontPx = [math]::Floor($Size * 0.42)
  $font = New-Object System.Drawing.Font 'Segoe UI', $fontPx, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 220, 248, 198))
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
  $g.DrawString('W', $font, $brush, $rect, $sf)
  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $icons | Out-Null
New-PwaIcon -Size 192 -OutPath (Join-Path $icons 'icon-192.png')
New-PwaIcon -Size 512 -OutPath (Join-Path $icons 'icon-512.png')
Write-Host 'PWA icons written to' $icons
