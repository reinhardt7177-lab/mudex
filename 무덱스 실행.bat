@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 무덱스
set "NODE=node"
if exist "%~dp0bin\node.exe" set "NODE=%~dp0bin\node.exe"
set "PATH=%~dp0bin;%PATH%"
echo.
echo   무덱스를 켭니다. 이 검은 창을 닫으면 무덱스도 꺼집니다.
echo.
"%NODE%" app\server.mjs
if errorlevel 1 pause
