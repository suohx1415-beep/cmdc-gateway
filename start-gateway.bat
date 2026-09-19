@echo off
title cmdc gateway 控制台
setlocal enabledelayedexpansion

rem ============================================================
rem  项目目录：如果挪动了项目位置，只改下面这一行
rem ============================================================
set "PROJECT=D:\claudeworkplace\cmdc反代"
set "CFG=%USERPROFILE%\.cmdc-gateway\config.json"

rem 用法：
rem   cmdc-gateway.bat                    打开菜单
rem   cmdc-gateway.bat 8888               本次用 8888 打开菜单
rem   cmdc-gateway.bat start|stop|restart|status [端口]

rem 端口优先取命令行参数，其次取配置文件里的固定端口，最后回落到 8810
set "PORT=%~2"
if "%PORT%"=="" (
  if exist "%CFG%" for /f "tokens=2 delims=:, " %%p in ('findstr /C:"port" "%CFG%" 2^>nul') do set "PORT=%%p"
)
if "%PORT%"=="" set "PORT=8810"
set "FIXEDPORT=%PORT%"
set "URL=http://127.0.0.1:%PORT%"

set "ACTION=%~1"
echo %ACTION%| findstr /R "^[0-9][0-9]*$" >nul 2>nul && (set "PORT=%ACTION%" & set "FIXEDPORT=%ACTION%" & set "URL=http://127.0.0.1:%ACTION%" & set "ACTION=")
if "%ACTION%"=="" set "ACTION=menu"

if not exist "%PROJECT%\src\server.mjs" (
  echo [错误] 找不到项目目录：%PROJECT%
  echo         请编辑本脚本中的 PROJECT 变量。
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，本网关需要 Node.js 22 或更高版本。
  echo         安装后重新运行本脚本：https://nodejs.org
  echo.
  pause
  exit /b 1
)

if /i "%ACTION%"=="start"   set "MENU=0" & goto do_start
if /i "%ACTION%"=="stop"    set "MENU=0" & goto do_stop
if /i "%ACTION%"=="restart" set "MENU=0" & goto do_restart
if /i "%ACTION%"=="status"  set "MENU=0" & goto do_status
set "MENU=1"

:menu
cls
call :isRunning
echo ============================================================
echo   cmdc gateway
echo ------------------------------------------------------------
if "!RUNNING!"=="1" (
  echo   状态    运行中    端口 %PORT%
) else (
  echo   状态    未运行    端口 %PORT%
)
echo   固定端口 %FIXEDPORT%
echo   本机客户端 http://127.0.0.1:%FIXEDPORT%/v1
echo   面板       %URL%/panel
echo ============================================================
echo.
echo   [1] 重启服务
echo   [2] 查看状态   （含局域网地址与访问密钥）
echo   [3] 关闭服务
echo   [4] 启动服务
echo   [0] 退出
echo.
set "choice="
set /p "choice=请选择: "
rem 直接回车或非交互运行时退出，避免死循环
if "%choice%"=="" goto bye
if "%choice%"=="1" goto do_restart
if "%choice%"=="2" goto do_status
if "%choice%"=="3" goto do_stop
if "%choice%"=="4" goto do_start
if "%choice%"=="0" goto bye
goto menu

:do_start
call :isRunning
if "!RUNNING!"=="1" (
  call :healthOk
  if "!HEALTH!"=="1" (
    echo.
    echo [提示] 服务已经在运行，端口 %PORT%
    echo        面板 %URL%/panel
    goto finish
  )
  echo.
  echo [占用] 端口 %PORT% 被别的程序占用了，它不是本网关。
  echo        固定端口不会被自动改掉，以免客户端 base_url 对不上。
  echo.
  echo   [1] 结束占用进程，然后照常启动
  echo   [2] 这次换个端口启动（不改固定端口）
  echo   [0] 取消
  echo.
  set "pick="
  set /p "pick=请选择: "
  if "!pick!"=="1" (
    call :killByPort
    call :waitStopped
  ) else if "!pick!"=="2" (
    echo.
    echo         想永久改端口：编辑 %CFG% 里的 "port"，或运行
    echo         node src\server.mjs --port 9000 --save-port
    echo.
    set "newport="
    set /p "newport=新端口: "
    if not "!newport!"=="" (
      set "PORT=!newport!"
      set "URL=http://127.0.0.1:!PORT!"
    )
  ) else (
    goto finish
  )
)
cd /d "%PROJECT%"
if not exist "models.json" (
  echo [初始化] 正在生成模型目录 models.json ...
  call node scripts\extract-models.mjs
  echo.
)
cd /d "%PROJECT%"
echo [启动] 正在启动服务，端口 %PORT% ...
if "%PORT%"=="%FIXEDPORT%" (
  rem 不加 --port，让服务用它自己记录的固定端口
  start "cmdc-gateway-%PORT%" /d "%PROJECT%" cmd /k node src\server.mjs
) else (
  start "cmdc-gateway-%PORT%" /d "%PROJECT%" cmd /k node src\server.mjs --port %PORT%
)
call :waitReady
if "!RUNNING!"=="1" (
  echo [完成] 服务已就绪
  echo        面板 %URL%/panel
  if /i not "%CMD_GATEWAY_NO_BROWSER%"=="1" start "" "%URL%/panel"
) else (
  echo [警告] 等待超时，服务可能启动失败，请查看新打开的日志窗口
)
goto finish

:do_stop
call :isRunning
if "!RUNNING!"=="0" (
  echo.
  echo [提示] 服务未在运行，端口 %PORT%
  goto finish
)
echo [停止] 正在关闭端口 %PORT% 上的服务 ...
call :killByPort
call :waitStopped
if "!RUNNING!"=="0" (
  echo [完成] 服务已停止
) else (
  echo [警告] 端口 %PORT% 仍被占用，可能有其他进程在监听
)
goto finish

:do_restart
call :isRunning
if "!RUNNING!"=="1" (
  echo [重启] 正在停止当前服务 ...
  call :killByPort
  call :waitStopped
  echo.
)
goto do_start

:do_status
cls
echo ============================================================
echo   cmdc gateway 状态
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h = Invoke-RestMethod -TimeoutSec 4 '%URL%/health'; Write-Host ('  状态       运行中'); Write-Host ('  监听       ' + $h.host + ':' + $h.port); Write-Host ('  固定端口   ' + $h.fixedPort); Write-Host ('  本机客户端 http://127.0.0.1:' + $h.fixedPort + '/v1'); if ($h.lanUrls -and $h.lanUrls.Count -gt 0) { foreach ($u in $h.lanUrls) { Write-Host ('  局域网     ' + $u + '/v1') } } else { Write-Host '  局域网     未开放' }; if ($h.lan -and $h.accessKeyRequired) { Write-Host ('  访问密钥   ' + $h.accessKey) ; Write-Host '  鉴权       127.0.0.1 免鉴权，其它地址必须带该密钥' }; Write-Host ('  后端       ' + $h.baseUrl + '  ' + $h.apiEnv); Write-Host ('  模型数     ' + $h.modelCount); Write-Host ('  凭据       ' + $(if ($h.hasApiKey) { '已加载' } else { '未登录' })); Write-Host ('  指纹       ' + $(if ($h.fingerprint) { '启用' } else { '关闭' })); Write-Host ('  cli 版本   ' + $h.cliVersion); Write-Host ('  面板       %URL%/panel') } catch { Write-Host '  状态       未运行'; Write-Host ('  说明       ' + '%URL% 无法连接'); Write-Host ('  固定端口   %FIXEDPORT%') }"
echo ============================================================
echo   账号 / 轮换 / 额度等详细信息请看面板
goto finish

:finish
echo.
if "%MENU%"=="1" (
  pause
  goto menu
)
endlocal
exit /b 0

:bye
endlocal
exit /b 0

rem ============================================================
rem  子过程
rem ============================================================

:isRunning
rem 端口处于 LISTENING 就把 RUNNING 置 1，并用 PIDS 收集进程号
set "RUNNING=0"
set "PIDS="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:"LISTENING" ^| findstr /C:":%PORT% "') do (
  set "RUNNING=1"
  set "PIDS=!PIDS! %%p"
)
exit /b 0

:healthOk
rem 只有 /health 认出是本网关才算健康，用来区分「本网关在跑」和「端口被别的进程占用」
set "HEALTH=0"
for /f "delims=" %%v in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "try{(Invoke-RestMethod -TimeoutSec 3 '%URL%/health').gateway}catch{}" 2^>nul') do set "HEALTH=%%v"
if /i "!HEALTH!"=="cmdc-gateway" set "HEALTH=1"
exit /b 0

:killByPort
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:"LISTENING" ^| findstr /C:":%PORT% "') do (
  taskkill /PID %%p /T /F >nul 2>nul
)
taskkill /FI "WINDOWTITLE eq cmdc-gateway-%PORT%" /T /F >nul 2>nul
exit /b 0

:waitReady
set /a n=0
:waitReadyLoop
call :isRunning
if "!RUNNING!"=="1" exit /b 0
set /a n+=1
if !n! GEQ 25 exit /b 1
ping -n 2 127.0.0.1 >nul 2>&1
goto waitReadyLoop

:waitStopped
set /a n=0
:waitStoppedLoop
call :isRunning
if "!RUNNING!"=="0" exit /b 0
set /a n+=1
if !n! GEQ 10 exit /b 1
ping -n 2 127.0.0.1 >nul 2>&1
goto waitStoppedLoop
