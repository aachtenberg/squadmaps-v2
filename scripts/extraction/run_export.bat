@echo off
REM Headless Squad Editor CSV export.
REM
REM Assumes the Squad SDK is installed at E:\epic\SquadEditor (override the
REM SDK_ROOT variable below if yours lives elsewhere). Drives the editor in
REM -nullrhi -unattended mode and runs LevelScript\run_export.py, which
REM dumps SquadLayers.csv, SquadVehicleLayers.csv, and SquadDeployables.csv
REM into <SDK_ROOT>\Squad\Saved\SquadMapsExport\.
REM
REM Invoke from WSL with:
REM   cmd.exe /d /c "pushd E:\epic\SquadEditor && %~nx0"

set SDK_ROOT=E:\epic\SquadEditor
"%SDK_ROOT%\UnrealEngine\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "%SDK_ROOT%\Squad\SquadGame.uproject" -ExecutePythonScript="%SDK_ROOT%\Squad\Content\Python\LevelScript\run_export.py" -stdout -unattended -nosplash -nullrhi
exit /b %ERRORLEVEL%
