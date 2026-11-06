<script setup>
// 用户协议与免责声明：面向本地离线运行的个人记录应用，明确许可、数据保管与使用边界
import Icon from '../components/Icon.vue'
import { APP_INFO } from '../lib/model.js'
</script>

<template>
  <div class="page wide">
    <div class="glass card">
      <div class="row" style="gap:10px">
        <span class="avatar" style="background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="book" :size="22" /></span>
        <div style="font-weight:800;font-size:17px">用户协议与免责声明</div>
      </div>
      <div class="muted" style="font-size:12px;margin-top:4px">更新于 2026-11-04 · 适用版本 v{{ APP_INFO.version }}（Web 端）</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">一、协议适用范围</div>
      <div style="font-size:14px;line-height:1.8">本协议是你与「地球Online」开发者之间关于使用本应用的约定。开始使用即视为已阅读并同意本协议；若不同意，请停止使用并清除本站点数据。本应用为个人向的本地工具，不提供账号、付费订阅或在线服务承诺。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">二、软件许可</div>
      <ul class="plist">
        <li>本应用以 <b>MIT 许可</b>开源发布：你可以自由使用、复制、修改与再分发，但须保留原版权与许可声明。</li>
        <li>应用本身<b>免费</b>，不包含内购、广告或强制联网校验；赞助为自愿行为，不构成任何服务购买。</li>
        <li>你可以在浏览器中安装为 PWA，或在符合许可的前提下自行部署、二次开发。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">三、数据与备份责任</div>
      <ul class="plist">
        <li>全部数据<b>保存在本机浏览器</b>（IndexedDB / localStorage），开发者无法访问、也无法恢复你的数据。</li>
        <li>清除浏览器站点数据、卸载 PWA、更换浏览器或设备、使用隐私模式等操作，均可能导致数据<b>永久丢失</b>；请自行定期通过「设置 → 导出备份」留存副本。</li>
        <li>若你启用 WebDAV 同步或导出文件分享，数据的保管与访问控制由你与对应服务方负责，开发者不承担由此产生的泄露、覆盖或丢失责任。</li>
        <li>跨设备 / 跨版本导入时，请先备份再操作；旧版本存档会按当前规则自动迁移，迁移后的格式可能无法回退到旧版本。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">四、插件与扩展</div>
      <ul class="plist">
        <li>插件由第三方或你自行编写，<b>不属于本应用本体</b>。请只安装来源可信的插件，并仅授予完成任务所必需的权限。</li>
        <li>导入插件清单（<code>eo-plugins.json</code>）等同于信任其中的代码并允许其在沙箱中运行；沙箱能阻断直接的页面与存储访问，但<b>不能保证插件行为完全无害</b>。</li>
        <li>插件造成的功能异常、数据被其写入内容覆盖或授权范围内的信息外发，由插件提供方与使用者自行承担，开发者不提供担保。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">五、第三方服务</div>
      <div style="font-size:14px;line-height:1.8">地图、AI、Steam、WebDAV 等能力由第三方提供，其可用性、准确性与数据处理规则由对应服务方负责。你填入的 Key、账号与密码仅保存在本机，请自行评估第三方服务的可信度；因第三方服务停服、限流、计费或政策变化造成的影响，开发者不承担责任。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">六、使用限制</div>
      <ul class="plist">
        <li>不得利用本应用从事违法活动，或将其用于侵犯他人隐私、传播恶意代码。</li>
        <li>不得以误导方式再分发被篡改的版本，或移除原作者与许可声明。</li>
        <li>请自行判断记录内容的准确性；本应用不提供医疗、法律、财务等专业建议。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">七、免责声明</div>
      <div style="font-size:14px;line-height:1.8">本应用按「现状」提供，不附带任何明示或默示担保，包括但不限于适销性、特定用途适用性与不侵权担保。在法律允许的最大范围内，开发者不对因使用或无法使用本应用而产生的任何直接或间接损失（含数据丢失、设备故障、第三方服务中断）承担责任。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">八、协议变更</div>
      <div style="font-size:14px;line-height:1.8">协议更新会在「设置 → 关于 → 更新日志」与本页面同步注明日期。变更后继续使用即视为接受新版本；如不接受，请停止使用。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">九、相关文档</div>
      <div style="font-size:14px;line-height:1.8">数据处理的细节请阅读<button class="chip" style="margin:0 4px" @click="$router.push('/privacy')">隐私政策</button>。两份文档共同构成你使用本应用时的完整约定。</div>
    </div>
  </div>
</template>

<style scoped>
.plist { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.9; }
.plist li { margin-bottom: 6px; }
.plist code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px; padding: 1px 6px; border-radius: 7px;
  background: var(--eo-chip); color: var(--eo-primary-deep);
  border: 1px solid var(--eo-glass-border); white-space: nowrap;
}
</style>
