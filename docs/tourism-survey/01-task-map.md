# Tasks.pdf 对照

## 任务一（前置，已部署）

| PDF 要求 | 实现 |
|----------|------|
| 输入地点并解析坐标 | `POST /api/survey/plan` · Google Geocoding / Nominatim |
| 显示目标与附近区域 | Cesium 青色调查圈 + 标签 |
| 半径/最低高度/拍摄数量 | 面板可调 |
| ≥5 观测角 | 圆周均匀生成 viewpoints |
| Cesium 模拟航线 | `routes` 折线 + 客户端模拟悬停拍摄 |
| 禁止 Street View | 未调用 |

## 任务二（主交付）

| PDF 要求 | 实现 |
|----------|------|
| 调查任务与状态 | `ready/running/paused/completed/cancelled/failed` |
| 5 点分配给无人机 | `drone_count` 轮询分配 `drone_id` |
| 起飞/移动/悬停/拍照/返航 | 指令日志 + 干跑执行器 |
| 记录位姿时间 | 每 shot `telemetry` |
| 照片关联任务 | `/photos/{shot_id}` + 画廊 |
| 断线重试/暂停/取消/失败 | API + WS |
| 先单机再多机 | 执行按顺序单通道；分配支持多机标签 |

打开：http://localhost:5173/survey-mission
