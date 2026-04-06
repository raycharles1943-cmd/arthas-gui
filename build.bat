@echo off
echo ========================================
echo Arthas GUI 应用程序构建脚本
echo ========================================
echo.

echo 1. 检查必要的资源文件...
if exist "resources\arthas-boot.jar" (
    echo   ✅ arthas-boot.jar 存在
) else (
    echo   ❌ arthas-boot.jar 不存在
    echo   请确保 resources\arthas-boot.jar 文件存在
    pause
    exit /b 1
)

if exist "resources\icon.ico" (
    echo   ✅ icon.ico 存在
) else (
    echo   ⚠️  icon.ico 不存在（可选）
)

echo.
echo 2. 验证package.json格式...
node -e "try { require('./package.json'); console.log('✅ package.json 格式正确'); } catch(e) { console.error('❌ package.json 格式错误:', e.message); process.exit(1); }"

echo.
echo 3. 清理之前的构建...
if exist "dist" (
    echo   删除 dist 目录...
    rmdir /s /q dist 2>nul
)
if exist "out" (
    echo   删除 out 目录...
    rmdir /s /q out 2>nul
)

echo.
echo 4. 构建应用...
echo   运行 electron-vite build...
call npm run build
if %errorlevel% neq 0 (
    echo   ❌ electron-vite 构建失败
    pause
    exit /b 1
)

echo.
echo 5. 打包Windows应用...
echo   运行 electron-builder --win...
call electron-builder --win
if %errorlevel% neq 0 (
    echo   ❌ electron-builder 打包失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo 构建完成！
echo.
echo 生成的文件：
echo   dist\ - 打包目录
echo   dist\Arthas GUI-0.1.0-win-x64.exe - 便携式应用
echo   dist\win-unpacked\ - 解压版应用
echo.
echo 注意事项：
echo   1. 首次运行时，系统可能会提示是否允许访问网络
echo   2. 如果出现"Arthas boot jar not found"错误，请检查应用日志
echo   3. 确保Java已安装并可在PATH中访问
echo ========================================
pause