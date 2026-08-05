# 05：摄像头与 Crazyflie 硬件

## 已确认的本机准备

- Apple Silicon macOS；Homebrew 的 `libusb 1.0.30` 已存在。
- 已有名为 `drone-navigation` 的 Python 3.12 环境；已验证 `cflib`、OpenCV、aiortc、PyAV、aiohttp 和 websockets 可导入。
- README 第 7 节所需的 `simple_webcam` Python 依赖因此已经满足；首次运行仍需要向实际终端授予 macOS 相机权限。

## 没有执行的硬件动作

未运行任何可能连接、解锁、电机测试、起飞、写 EEPROM 或发布真实视频流的脚本。没有检测到/声明任何 Crazyradio、Crazyflie、AI-Deck 或摄像头已由本次工作接管。

## 安全启动顺序

1. 确认 MediaMTX 使用的是本次专用配置或你已确认的既有实例。
2. 先用 `simple_crazyflie/01_connect.py` 验证无线链路。
3. 之后再依序执行遥测、螺旋桨检查；仅在清空场地且电池健康时考虑飞行脚本。
4. 对完整网页桥接，先设置 `CF_NO_FLY=1` 进行干跑，并使用 README 的 `e2e_command_check.py`。

## 清理

本部分未新增硬件文件或服务。MediaMTX、数据库与 OpenClaw 的新增内容均集中在总清单指定的专用目录。
## 2026-08-04：macOS 第 7 节摄像头实测

- `system_profiler SPCameraDataType` 确认本机存在“MacBook Air 相机”。
- 原 `simple_webcam.py` 只检查 Linux 的 `/dev/video0-3`，在 macOS 上不会打开摄像头。
- 已让脚本在 macOS 使用 OpenCV AVFoundation 后端，并保留 Linux 的 `/dev/videoN` 行为。
- 本机 MediaMTX 配置补充 `paths.all_others`，允许 `crazyflie-drone` 这类本地测试流。
- 实测 WHIP 返回 HTTP 201，MediaMTX `crazyflie-drone` 状态为 `ready: true`，摄像头首帧已捕获。
- 当前测试推流运行在本次终端会话中；结束该会话或按 `Ctrl+C` 即停止推流。
