# Agent-Shared 共享空间使用规则

## 这个目录是什么
Agent-Shared 是所有 Agent 共享的记忆空间。任何 Agent 写入的内容，其他 Agent 都能读到。

## 文件说明
| 文件 | 用途 | 谁写 |
|------|------|------|
| user-profile.md | 用户画像和偏好 | 所有 Agent 可写，发现新偏好时追加 |
| project-state.md | 项目/任务状态 | 所有 Agent 可写，状态变化时更新 |
| decisions-log.md | 用户的重要决策 | 所有 Agent 可写，只追加不修改 |
| knowledge/ | 共享知识库 | 按主题一个文件 |

## 写入规则
1. 只追加，不覆盖
2. 写入时标注来源：`[by Agent-XXX, YYYY-MM-DD]`
3. 不删除其他 Agent 写入的内容
4. 不修改已记录的决策
