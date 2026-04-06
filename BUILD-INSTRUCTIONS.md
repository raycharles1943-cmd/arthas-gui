# Arthas GUI 构建说明

## 🚀 简化的构建方法

由于Windows PowerShell执行策略限制，建议使用以下方法构建：

### 方法1：使用批处理文件（推荐）
```
直接双击 build.bat
```

### 方法2：手动构建步骤
```
1. 检查资源文件：
   - resources/arthas-boot.jar (必须存在)
   - resources/icon.ico (可选)

2. 清理旧构建：
   rm -rf dist out

3. 执行构建：
   npm run build

4. 打包应用：
   npx electron-builder --win
```

### 方法3：使用简化的npm脚本
```
npm run build:win-simple
```

## 🛠️ 修复的打包相关问题

### 已解决的核心问题
1. ✅ **Arthas jar文件找不到**：在生产环境下无法定位资源文件  
   - 修复：添加了 `findResourceFile()` 函数，智能搜索资源文件位置
   - 路径搜索顺序：resources目录 → app子目录 → 直接路径

2. ✅ **JSON语法错误**：package.json中包含非法JSON注释  
   - 修复：移除了所有 `//` 注释

3. ✅ **PowerShell执行策略问题**：Windows限制脚本执行  
   - 解决：提供了批处理文件构建方案

### 关键修改文件
- `src/main/index.ts` - 核心路径查找逻辑
- `package.json` - 修复的JSON格式和build配置
- `build.bat` - Windows批处理构建脚本

## 📦 构建后测试

打包成功后，运行 `dist/Arthas GUI-0.1.0-win-x64.exe`，注意：

1. **首次运行可能需要网络权限**：Arthas需要连接到本地端口
2. **查看应用日志**：如有问题，查看控制台输出的路径查找信息
3. **确保Java已安装**：应用需要Java来附加到目标进程

## 🔧 故障排除

### 常见问题
1. **"Arthas boot jar not found"**
   - 原因：资源文件路径不正确
   - 解决：查看应用日志中的资源查找输出
   - 检查：运行应用时是否显示`✅ 找到文件: ...`日志

2. **打包失败**
   - 原因：npm脚本执行问题
   - 解决：使用 `build.bat` 或手动构建步骤

3. **附加Java进程失败**
   - 原因：Java未安装或无权限
   - 解决：确保Java在PATH中，以管理员身份运行

## 📞 支持

如仍有问题，请查看：
- 应用运行时的控制台日志
- 检查 `dist/win-unpacked/resources/` 中是否包含 `arthas-boot.jar`
- 验证Java安装：运行 `java -version`