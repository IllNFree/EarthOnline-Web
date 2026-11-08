// ===== 画布工作区单例 =====
// 画布、相册等多条路由共用同一份 Workspace，避免多处 new 造成存档互相覆盖。
import { Workspace } from './core/workspace.js'

const ws = new Workspace()
const saved = ws.loadSaved()
if (!saved) ws.seedDemo()

export const hadSaved = !!saved
export default ws
