# Drone Navigation 协作交接

这个目录是当前工作树的源码快照，包含机群控制、Cesium 3D 视图、无人机模型和 Crazyflie bridge 的最新改动。压缩包不包含 Git 历史、依赖目录、构建产物、本机数据库或任何密钥。

## Windows 快速启动（推荐给接收者）

这个项目原本就是按 Windows 10/11 + WSL2 Ubuntu 组织的。解压后在 PowerShell 运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\Setup-DroneNavigation.ps1 -SkipPython
.\scripts\windows\Start-DroneNavigationDemo.ps1
```

浏览器打开 `http://127.0.0.1:5173/?fleet=demo`。完整说明见 `WINDOWS-QUICKSTART-zh-CN.md`。

安装脚本会把项目放到 WSL 用户目录；如果已有 `~/drone-navigation` 且锁文件一致，会直接复用它的 `node_modules`、本地配置和 `drone-navigation` conda 环境，否则才按 `package-lock.json` 和 `requirements.txt` 安装。默认不会覆盖旧目录。

## macOS 快速启动

```bash
cd client
npm install
cp config.example.json config.json
# 编辑 config.json，填写 googleApiKey、cesiumIonToken；OpenClaw 可选
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/?fleet=demo` 可以先查看多无人机演示。只改前端界面或模型时，不需要启动 PostgreSQL、Synapse、OpenClaw 或真实无人机 bridge。

完整后端、数据库、MediaMTX、OpenClaw 和 Crazyflie 流程见：

- `README-macos-zh.md`
- `client/README.md`
- `setup-notes/`

## 开始协作前

1. 不要把 `client/config.json`、`server/config.json`、`.env`、token、私钥或真实无人机地址提交到公共位置。
2. 先运行 `git status --short`，确认自己是在当前工作树上继续，而不是覆盖其他人的改动。
3. 前端改动后运行 `npm run build`；机群逻辑可运行 `npm run test:fleet`。
4. 模型由 `scripts/generate-fleet-drone-model.mjs` 生成，修改脚本后重新生成 `client/public/models/fleet-drone.gltf`。
5. 涉及真实 Crazyflie 时，先保持仿真和地面测试，不要把网页演示状态当成真实飞行就绪。

## 本次模型改动

`client/public/models/fleet-drone.gltf` 已从单一简化几何体更新为多部件侦察四旋翼，包含机身、交叉机臂、四个电机和旋翼、起落架、下置相机、顶部天线及橙色机头方向标识。Cesium 机群图层保留模型自身材质，只使用少量机群颜色作为身份提示。

## 本机脚本提示

`scripts/start-local-stack.sh` 是当前 macOS 机器的本地一键启动脚本，其中包含本机路径和运行时目录。其他电脑应先按 `README-macos-zh.md` 配置环境，并把脚本里的路径改成自己的路径；只做前端协作时直接运行 `client/npm run dev` 即可。
