@echo off
rem Builds, tests and writes the release zip dist\EnshroudedLiveMap-<version>.zip:
rem iphlpapi.dll, the livemap folder (web\ without generated data), README.txt, LICENSE, notices.
cd /d "%~dp0"
call "%~dp0build.cmd" || exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$v = [regex]::Match((Get-Content CMakeLists.txt -Raw), 'VERSION (\d+\.\d+\.\d+)').Groups[1].Value;" ^
  "$stage = 'dist\stage'; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $stage | Out-Null;" ^
  "Copy-Item build\iphlpapi.dll, package\README.txt, LICENSE, THIRD_PARTY_NOTICES.md $stage;" ^
  "New-Item -ItemType Directory \"$stage\livemap\" | Out-Null;" ^
  "Copy-Item web\index.html, web\maps.json, web\pois.json, web\pois.json.gz, web\weather.json, web\weather.json.gz \"$stage\livemap\";" ^
  "Copy-Item web\icons, web\tiles \"$stage\livemap\" -Recurse;" ^
  "$zip = \"dist\EnshroudedLiveMap-$v.zip\"; Remove-Item $zip -ErrorAction SilentlyContinue;" ^
  "& \"$env:SystemRoot\System32\tar.exe\" -a -c -f $zip -C $stage iphlpapi.dll livemap README.txt LICENSE THIRD_PARTY_NOTICES.md; if ($LASTEXITCODE) { throw 'tar failed' };" ^
  "Remove-Item $stage -Recurse -Force;" ^
  "Write-Output \"$zip\"; Get-FileHash build\iphlpapi.dll -Algorithm SHA256 | ForEach-Object { 'iphlpapi.dll sha256 ' + $_.Hash.ToLower() }" || exit /b 1
rem Optional file for Nexus: the HD map style, only when local-maps\tiles-hd exists (made with
rem tools\enhance_map.py; the picture is not in the repository).
if not exist local-maps\tiles-hd exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$v = [regex]::Match((Get-Content CMakeLists.txt -Raw), 'VERSION (\d+\.\d+\.\d+)').Groups[1].Value;" ^
  "$stage = 'dist\stage-hd'; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory \"$stage\livemap\" | Out-Null;" ^
  "Copy-Item package\hd\README-HD.txt $stage; Copy-Item package\hd\maps.json \"$stage\livemap\"; Copy-Item local-maps\tiles-hd \"$stage\livemap\tiles-hd\" -Recurse;" ^
  "$zip = \"dist\EnshroudedLiveMap-HDMap-$v.zip\"; Remove-Item $zip -ErrorAction SilentlyContinue;" ^
  "& \"$env:SystemRoot\System32\tar.exe\" -a -c -f $zip -C $stage livemap README-HD.txt; if ($LASTEXITCODE) { throw 'tar failed' };" ^
  "Remove-Item $stage -Recurse -Force; Write-Output \"$zip\"" || exit /b 1
