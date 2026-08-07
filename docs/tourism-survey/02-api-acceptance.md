# API 与验收

## Health

`GET /api/survey/health` → `version: 1`

## 计划

`POST /api/survey/plan`  
body: `{ "place", "radius_m", "min_alt_m", "photo_count", "drone_count" }`

## 任务

- `POST /api/survey/missions` `{ plan_id, dry_run }`
- `POST .../start|pause|cancel|retry`
- `WS /api/survey/missions/{id}/ws`
- `GET .../photos/{shot_id}`
- `POST .../shots/{shot_id}/photo` 手动上传

## 验收清单

- [ ] 输入地点生成 ≥5 点并在 Cesium 可见
- [ ] 模拟观测动画跑完
- [ ] 创建任务并开始干跑，指令日志出现 takeoff/move/hover/photo/return/land
- [ ] 画廊可见 ≥5 张图
- [ ] 暂停/取消/重试可用
- [ ] 节点 8 其它页不受影响
