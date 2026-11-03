param(
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$X = 0,
  [int]$Y = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
$proc = Get-Process -Name oneos -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$h = $proc.MainWindowHandle
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"screen=$($screen.Width)x$($screen.Height)"
if ($Width -gt 0 -and $Height -gt 0) {
  [W32]::MoveWindow($h, $X, $Y, $Width, $Height, $true) | Out-Null
  Start-Sleep -Milliseconds 800
}
[W32]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 500
$r = New-Object W32+RECT
[W32]::GetWindowRect($h, [ref]$r) | Out-Null
$c = New-Object W32+RECT
[W32]::GetClientRect($h, [ref]$c) | Out-Null
$pt = New-Object W32+POINT
[W32]::ClientToScreen($h, [ref]$pt) | Out-Null
"window=$($r.Left),$($r.Top) size=$($r.Right-$r.Left)x$($r.Bottom-$r.Top) clientOrigin=$($pt.X),$($pt.Y) client=$($c.Right)x$($c.Bottom)"
