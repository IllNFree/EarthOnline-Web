// v2.0.0 P0 数据契约回归（Node 原生 ESM，零依赖）：node tests/smoke_v2_contract.mjs
// 覆盖：WebDAV 文件名 / lastSyncAt 冲突判定 / deletedAt 软删除 / 历史 trash[] 迁移 /
//      主键合并语义 / 版本统一 —— 与 Android 端 upsert(REPLACE) 语义对齐。
import { sanitizeState, defaultState, trashList, purgeExpiredSoftDeleted, liveList } from '../src/lib/model.js'
import * as ops from '../src/lib/ops.js'
import { mergeBackup, remoteIsNewer, DEFAULT_REMOTE_PATH, remotePathOf } from '../src/lib/webdav.js'
import { readFileSync } from 'node:fs'

let fail = 0
const ok = (c, m) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + m); if (!c) fail++ }

console.log('[1] WebDAV 远端文件名（跨端统一）')
ok(DEFAULT_REMOTE_PATH === '/earth_online_backup.json', '默认路径 = /earth_online_backup.json')
ok(remotePathOf({ path: 'x/y.json' }) === '/x/y.json', '自填路径自动规范化')
ok(remotePathOf({}) === '/earth_online_backup.json', '缺省回落到默认')

console.log('[2] lastSyncAt 冲突判定')
ok(remoteIsNewer('2026-10-26T00:00:00.000Z', '') === true, '无本地水位线 \u2192 认为云端新')
ok(remoteIsNewer('2026-10-25T00:00:00.000Z', '2026-10-26T00:00:00.000Z') === false, '云端更旧 \u2192 拒绝落库')
ok(remoteIsNewer('2026-10-27T00:00:00.000Z', '2026-10-26T00:00:00.000Z') === true, '云端更新 \u2192 允许落库')

console.log('[3] 软删除 deletedAt 模型')
const s = defaultState()
ok(s.cardAlpha === 0.8, '卡片默认不透明度 = 80%（对齐 Android 0.8f）')
const t = ops.addTask(s, { title: '软删测试' }).task
ops.deleteTask(s, t.id)
ok(s.tasks.some((x) => x.id === t.id), '记录仍留在原集合内')
ok(!!s.tasks.find((x) => x.id === t.id).deletedAt, '实体带 deletedAt 时间戳')
ok(liveList(s, 'tasks').length === 0, 'live 视图过滤掉已删记录')
ok(trashList(s).length === 1, '回收站派生出 1 条')
const p = ops.addPhoto(s, { dataUrl: 'data:image/png;base64,AAA', name: '照片' }).photo
ops.deletePhoto(s, p.id)
ok(trashList(s).length === 2, '相册同样进回收站（六类全覆盖）')
ok(trashList(s)[0].expireAt > new Date().toISOString().slice(0, 10), '30 天过期时间正确派生')
ops.restoreFromTrash(s, t.id)
ok(!s.tasks.find((x) => x.id === t.id).deletedAt, '恢复后 deletedAt 清空')
ok(liveList(s, 'tasks').length === 1, '恢复后回到正常列表')
ops.purgeTrashEntry(s, p.id)
ok(!s.photos.some((x) => x.id === p.id), '永久删除真正移除记录')
ops.emptyTrash(s)
ok(trashList(s).length === 0, '清空回收站生效')

console.log('[4] 过期清理（TTL 30 天）')
const s2 = defaultState()
const oldMemo = ops.addMemo(s2, { title: '过期', markdown: 'x' }).memo
ops.deleteMemo(s2, oldMemo.id)
s2.memos.find((x) => x.id === oldMemo.id).deletedAt = '2020-01-01T00:00:00.000Z'
const purged = purgeExpiredSoftDeleted(s2)
ok(purged === 1 && !s2.memos.some((x) => x.id === oldMemo.id), '超过 30 天 \u2192 物理移除')

console.log('[5] 历史 trash[] \u2192 deletedAt 自动迁移')
const legacy = defaultState()
legacy.trash = [{ id: 'tr1', kind: 'task', data: { id: 'old1', title: '老回收项' }, deletedAt: '2026-10-20T00:00:00.000Z', expireAt: '2026-11-19' }]
const mg = sanitizeState(legacy)
ok(mg.tasks.some((x) => x.id === 'old1' && x.deletedAt), '老记录搬回 tasks 集合且带 deletedAt')
ok(mg.trash.length === 0, '迁移后 trash 数组清空')
ok(trashList(mg).length === 1, '回收站仍可见老数据（用户无感）')

console.log('[6] 主键合并语义（对齐 Android @Insert(REPLACE)）')
const local = defaultState(); const remoteRec = ops.addTask(local, { title: '本地同主键' }).task
const cloud = defaultState()
cloud.tasks.push({ id: remoteRec.id, parentId: null, category: 'side', title: '云端同主键', status: 'planning', progress: 0, note: '', dueDate: null, dueTime: null, createdAt: '2026-10-01', lastModified: '2026-10-26', doneAt: null, tags: [] })
const onlyCloud = ops.addTask(cloud, { title: '云端独有' }).task
const { patch, added } = mergeBackup(local, cloud)
ok(patch.tasks.length === 2, '合并后主键数 = 2（同主键合并 + 独有补入）')
ok(patch.tasks.find((x) => x.id === remoteRec.id).title === '云端同主键', '同主键以入站侧覆盖（对齐 Android REPLACE）')
ok(patch.tasks.some((x) => x.id === onlyCloud.id), '云端独有主键进入结果')
ok(added >= 1, '返回新增计数 = ' + added)

console.log('[7] 版本号四处统一')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
const { APP_INFO } = await import('../src/lib/model.js')
ok(pkg.version === '2.0.0', 'package.json = 2.0.0')
ok(APP_INFO.version === '2.0.0', 'APP_INFO.version = 2.0.0')
ok(!!pkg.scripts.start, '存在生产启动脚本：' + pkg.scripts.start)

console.log(fail === 0 ? '\n全部契约断言通过 \u2705' : '\n失败 ' + fail + ' 项 \u274C')
process.exit(fail === 0 ? 0 : 1)
