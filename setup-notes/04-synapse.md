# 04：Synapse（社区聊天）

## 当前状态：已完成

- 已安装 README 固定的 `matrix-synapse==1.157.1` 到专用虚拟环境。
- 已生成 homeserver 配置，监听仅限 `::1` 和 `127.0.0.1:8008`。
- 已移除 federation 资源、显式关闭公开注册。
- 已创建本地管理员，并将管理员访问令牌安全回填至项目 `server/config.json` 的 `synapse.admin_access_token`。
- Synapse 正在独立 screen 会话 `drone_navigation_synapse` 中运行；`/_matrix/client/versions` 已验证可达。

## 已新增且可清理的内容

- `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/synapse-venv/`：隔离 Python 虚拟环境。
- `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/synapse-data/`：homeserver 数据、日志、签名密钥与 SQLite 聊天数据库。
- `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/synapse-admin-credentials.env`：管理员凭据，权限仅当前用户可读。
- `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/synapse-pip-install.log`：完整安装日志。

这些内容全部位于本次专用根目录；不影响系统 Python、Conda 或现有服务。

## 已知安装过程

首次下载曾遇到 TLS 中断。后续在独立 screen 会话中持续编译了 Synapse 的 Rust 组件，最终安装成功；该过程和日志均已保留在专用目录。

## 清理

先执行 `/usr/bin/screen -S drone_navigation_synapse -X quit` 停止服务；再删除专用根目录即可清理所有 Synapse 内容。
