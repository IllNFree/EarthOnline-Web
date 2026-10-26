# 地球Online 四端数据契约

本文件是四端（Web / Android / Desktop / iOS）数据备份与同步的唯一权威契约来源。任何一端修改备份结构，必须先在此登记并得到跨端确认。

备份文件名固定为 `earth_online_backup.json`，通过 WebDAV 在四端之间同步。

## 三条硬规则

### 1. 字段命名全 camelCase

备份 JSON 的所有键名使用 camelCase，与代码内模型一一对应。禁止在不同端混用 snake_case 或帕斯卡命名。新增字段必须走 camelCase，并在下方字段清单登记。

### 2. WebDAV 按主键合并

导入备份时严格按业务主键合并，绝不整包覆盖：

- 命中主键（Web / Android 的 `id`、iOS 的 `recordId`）：以修订时间新者为准更新字段，本地独有字段保留。
- 未命中主键：作为新增插入。
- 冲突比对以 `lastSyncAt` / `exportedAt` 水位线为准：云端不比本地新时拒绝落库并如实提示，杜绝"误拉抹掉本地新增"。

### 3. 软删除对齐

删除操作统一为实体留在原集合并写入 `deletedAt`（ISO 时间串），不搬移至独立回收站集合。软删除数据不跨端导出。恢复 / 永久删除 / 30 天过期清理由各端本地实现，但 `deletedAt` 字段语义必须一致。

## 字段清单

`version`、`exportedAt`、`profile`、`tasks`、`memos`、`items`、`achievements`、`collections`、`locations`、`activities`、`photos`、`home_entry_order`

（v2.0.0 起新增 `photos` 与 `home_entry_order`；任何新增顶层字段须在此追加。）

## 契约变更流程

1. 提出方在 Web 仓库本文件提交变更（新增 / 重命名字段、调整合并语义）。
2. 在四端仓库同步实现，并各自通过 `EarthOnline-Tools/qa/validate_backup_contract.js` 契约校验。
3. 跨端联调：以 Android 为 canonical，验证 Web / Desktop / iOS 导入导出互不改变语义。
4. 变更随下一次发版（打 tag）生效，CHANGELOG 由 git-cliff 自动记录。
