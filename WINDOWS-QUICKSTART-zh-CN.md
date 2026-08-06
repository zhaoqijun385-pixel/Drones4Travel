# Windows 交付包快速启动

这个项目沿用原来的 **Windows 10/11 + WSL2 Ubuntu** 环境，不把 macOS 的 `node_modules` 或 Python 虚拟环境打进包里。Windows 依赖会在 WSL 内按项目自己的 `package-lock.json` 和 `requirements.txt` 安装，这样可以复用原项目的 Node、conda、PostgreSQL 和服务布局。

## 最快看到机群演示

1. 解压压缩包到一个普通目录，例如 `D:\drone-navigation-share`。
2. 用 Windows Terminal 打开 PowerShell，进入解压目录：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\Setup-DroneNavigation.ps1 -SkipPython
.\scripts\windows\Start-DroneNavigationDemo.ps1
```

3. 在 Windows 浏览器打开：

```text
http://127.0.0.1:5173/?fleet=demo
```

`-SkipPython` 只跳过 FastAPI/Crazyflie 依赖，前端机群演示仍然可以启动。

## 完整复用原项目环境

如果需要后端、数据库和 bridge，先在管理员 PowerShell 安装 WSL2：

```powershell
wsl --install -d Ubuntu
wsl --set-default-version 2
```

首次进入 Ubuntu 后，按原项目流程准备 Node、conda 和基础工具：

```bash
sudo apt update
sudo apt install -y git curl python3 python3-venv build-essential
```

如果 WSL 里已经有旧的 `~/drone-navigation`，安装脚本会优先复用它的 `client/node_modules`、本地配置和 `drone-navigation` conda 环境；没有时才安装或创建：

```powershell
.\scripts\windows\Setup-DroneNavigation.ps1
```

如果旧项目不在默认位置，可以显式指定：

```powershell
.\scripts\windows\Setup-DroneNavigation.ps1 -ExistingProjectPath "~/old-drone-navigation"
```

默认会把源码复制到 WSL 的 `~/drone-navigation-share`，不会覆盖已有的 `~/drone-navigation` 原项目。需要换路径时：

```powershell
.\scripts\windows\Setup-DroneNavigation.ps1 -WslProjectPath "~/drone-navigation-share-02"
```

## 配置 API key

脚本会自动从模板创建：

- `client/config.json`
- `server/config.json`

API key 和 OpenClaw token 需要接收者自己填写。不要把你本机的真实配置复制进公共压缩包。

## 继续开发

前端源码实际位于 WSL 的 `~/drone-navigation-share/client`，建议在 WSL 内运行 `npm install`、`npm run build` 和测试，不要把依赖安装到 Windows 挂载目录下。完整服务和 Crazyradio/usbipd-win 流程继续看 `README-zh.md` 与 `setup-notes/`。
