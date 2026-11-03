@echo off
setlocal
set MT="C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe"
set MAN=D:\OneOS\logs\qemu-manifest-portable.xml
set TARGET=D:\OneOS\resources\installers\qemu-w64-setup-portable.exe
%MT% -nologo -manifest "%MAN%" -outputresource:"%TARGET%";#1
echo mt_exit=%ERRORLEVEL%
