# 03：客服与视频服务

## OpenClaw

- 已安装 `OpenClaw 2026.7.1-2` 到 `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/openclaw`，没有进行全局 npm 安装。
- 已将项目的 `deployment/openclaw/openclaw.json` 复制为专用本地配置；原模板、客户端配置和其中任何密钥均未修改或显示。
- 已确认模板的百炼模型提供商、网关端口 `18789` 与客户端 token 完全匹配。
- 网关已运行于 `127.0.0.1:18789`，位于 screen 会话 `drone_navigation_openclaw`；健康检查正常，默认模型为 `bailian-token-plan/qwen3.8-max-preview`。
- 已关闭 `allowInsecureAuth`；配置和状态目录均设为仅当前用户可读写。
- 本项目自定义客服网页只携带 token、未实现 OpenClaw 的设备身份协议，因此在排障后启用了 `dangerouslyDisableDeviceAuth: true` 兼容开关。网关仍只绑定 `127.0.0.1`/`::1`，并要求现有的高强度 token；不可将此网关暴露到局域网或公网。
- 已用真实浏览器验证 `http://localhost:5173/customer-service` 显示 `Online`。未发送测试消息，避免产生模型调用费用。
- npm 报告 4 个依赖安装脚本未获额外批准；本次没有盲目放行它们。

## MediaMTX

- 已下载 README 指定的 Apple Silicon `MediaMTX v1.9.0` 到 `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/mediamtx`。
- 已单独写入本地回环配置 `mediamtx-local.yml`：WHEP/WHIP 使用 8889，HLS 使用 8888，控制 API 使用 9997，控制 API 仅允许本机访问。
- 已停止旧 MediaMTX（其工作目录为 `.Trash/drone-navigation-macos-clean`），未删除其文件。
- 本次下载的专用 MediaMTX 已接管 `127.0.0.1:8889` 与 `127.0.0.1:9997`，运行在 screen 会话 `drone_navigation_mediamtx`；控制 API 已验证可达，当前无推流路径。

## 启动条件与验证

已使用以下命令启动：

```bash
/Users/quentincrane/.local/share/drone-navigation-setup-20260804/mediamtx/mediamtx \
  /Users/quentincrane/.local/share/drone-navigation-setup-20260804/mediamtx/mediamtx-local.yml
```

随后在项目的 `drone-navigation` Python 环境中运行 README 第 7 节的 `simple_webcam.py`。首次运行须在 macOS 的“隐私与安全性 → 相机”中授权实际使用的终端应用。

## 清理

先执行以下命令停止服务：

```bash
/usr/bin/screen -S drone_navigation_openclaw -X quit
/usr/bin/screen -S drone_navigation_mediamtx -X quit
```

两项内容都位于 `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/`。在确认相关进程已停止后，删除该目录即可清理下载、配置和 npm 包；不会影响项目内已有文件。
