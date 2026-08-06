# Contributing to Drone Navigation

欢迎贡献！本文档涵盖从设置开发环境到提交 PR 的完整流程。

## 行为准则

- 尊重他人，不发表侮辱性或歧视性言论。
- 聚焦技术问题，不讨论政治、宗教等无关话题。
- 代码审查的目的是提高质量，不是攻击个人。

## 开始之前

1. **阅读 README**：确保理解项目的技术栈和运行方式（[README.md](README.md) 或 [README-zh.md](README-zh.md)）。
2. **确认许可证**：[LICENSE](LICENSE) 是本项目的专有 EULA，贡献的代码将成为本软件的一部分，受同一许可证约束。
3. **安全第一**：本项目管理真实无人机。任何涉及飞控、bridge、motion control、e-stop 的改动必须通过额外的安全审查。

## 开发流程

### 1. 分支策略

```
main（稳定分支，通过 PR 合并）
 └── twin（主开发分支）
      └── feature/<描述>（功能分支）
```

- **永远不要直接 push 到 `main`**（已设置分支保护后）。
- 从 `twin` 切出功能分支进行开发。
- 完成后提 PR 到 `twin`，审查通过后再合并到 `main`。

### 2. 设置开发环境

**Windows 10/11 + WSL2**（推荐）：

```powershell
# Windows PowerShell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\Setup-DroneNavigation.ps1
.\scripts\windows\Start-DroneNavigationDemo.ps1
```

**macOS / Ubuntu**：参考对应平台的 README：
- [README-macos.md](README-macos.md) / [README-macos-zh.md](README-macos-zh.md)
- [README-ubuntu.md](README-ubuntu.md) / [README-ubuntu-zh.md](README-ubuntu-zh.md)

**仅前端开发**（不需要数据库 / 后端 / 无人机）：

```bash
cd client
npm install
cp config.example.json config.json  # 填写 googleApiKey 和 cesiumIonToken
npm run dev
# 浏览器打开 http://localhost:5173/?fleet=demo
```

### 3. 提交代码前

在你提交 PR 之前，确保以下命令在你的环境中通过：

```bash
# 前端
cd client
npm run test:fleet   # 机群逻辑测试
npm run build        # 生产构建

# 后端
cd server
python -m unittest discover tests -v   # 后端单元测试

# 代码风格
git diff --check     # 检查空白问题
```

### 4. Commit 规范

使用语义化的 commit message：

```
<type>: <short description>

<optional body — what and why, not how>
```

类型（type）：
- `feat:` — 新功能
- `fix:` — Bug 修复
- `docs:` — 纯文档改动
- `refactor:` — 重构（不改变行为）
- `test:` — 添加或修改测试
- `chore:` — 构建、CI、依赖等杂项
- `style:` — 格式、空白（不改变逻辑）

示例：
```
feat: add multi-drone collision warning overlay

Show a proximity ring around each drone and flash red when any two
drones come within 3 meters of each other. The ring radius scales
with the drone's current speed.
```

### 5. PR 流程

1. 在 GitHub 上创建 Draft PR（如果还在开发中）。
2. 填写 PR 模板中的各项内容。
3. **飞控相关的 PR 必须标注 Safety Impact**。
4. 至少一人审查并通过后合并。
5. 如果 CI（GitHub Actions）失败，先修复再请求审查。

## 安全特别规定

本项目控制**真实硬件**（Crazyflie 无人机）。以下改动类型必须：

| 改动类型 | 额外要求 |
|----------|----------|
| `crazyflie_bridge/` 下的任何文件 | 至少一次 bench 测试（无桨/安全架） |
| `drone_commands.py`、`fleet.py` 中的命令路由 | 仿真 + bench 测试 |
| e-stop 链 (`red_stop`) | 双人审查 |
| `multi_bridge.py` | 必须通过 `--check` 模式 |
| 新增飞行模式 / 任务类型 | 必须附带仿真测试 |

## 测试指南

- **机群逻辑测试**：`client/tests/` 下的测试覆盖 mission planner、manual flight、altitude math、controller physics。添加新的机群行为时请同步添加测试。
- **后端测试**：`server/tests/` 包含 fleet WebSocket、OpenClaw agent 生命周期和控制权租约的单元测试。
- **真机测试**：参考 `setup-notes/15-fleet-acceptance-and-hardware-handover.md` 中的验收流程。

## 获取帮助

- 提交 Issue 或 PR 时在描述中 @ 仓库维护者。
- 对于环境配置问题，先查阅对应平台的 README 和 `setup-notes/` 目录。
- 对于 Crazyflie 硬件问题，参考 `extension/simple_crazyflie/` 和 `extension/crazyflie_bridge/` 中的文档。
