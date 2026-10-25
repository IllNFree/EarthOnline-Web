<script setup>
// 隐私政策：如实描述本应用的数据行为（纯本地，无服务器、无账号、无埋点）
import Icon from '../components/Icon.vue'
</script>

<template>
  <div class="page wide">
    <div class="glass card">
      <div class="row" style="gap:10px">
        <span class="avatar" style="background:var(--eo-chip);color:var(--eo-primary-deep)"><Icon name="shield" :size="22" /></span>
        <div style="font-weight:800;font-size:17px">隐私政策</div>
      </div>
      <div class="muted" style="font-size:12px;margin-top:4px">更新于 2026-10-25 · 适用版本 v2.0.0（Web 端）</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">一句话总结</div>
      <div style="font-size:14px;line-height:1.8">地球Online 是一个<b>以本地存储为核心</b>的个人生活记录应用：没有服务器、没有账号体系、没有埋点统计。你的每一条记录都只存在于这台设备的浏览器中。只有当你<b>主动</b>使用需要联网的功能时，才会向对应的第三方服务发起请求，且这些请求与你填写的第三方凭据直接相关。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">一、本地数据存储</div>
      <ul class="plist">
        <li>所有记录（任务 / 笔记 / 相册 / 足迹 / 记账 / 成就等）保存在本机 <b>IndexedDB</b>，偏好设置（主题、壁纸、外观参数）保存在本机 <b>localStorage</b>。</li>
        <li>这些数据<b>不会</b>自动上传到任何服务器，也不会与你的身份信息关联。</li>
        <li>清除浏览器站点数据 = 永久删除全部数据，请先在「设置 → 导出备份」做好备份。</li>
        <li>「回收站」中的删除项保留 30 天，到期自动清除；「清空全部数据」会立即抹除本机所有记录。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">二、第三方服务与数据处理规范</div>
      <div style="font-size:14px;line-height:1.8;margin-bottom:8px">下列第三方服务仅在你<b>主动触发</b>相应功能时才会被调用。我们不会把你的生活数据、身份信息或凭据出售、共享给它们，也不会在后台静默调用。</div>
      <ul class="plist">
        <li><b>高德地图 API（AMap）</b>：用于「足迹」页的地图渲染与地点搜索。调用时浏览器会向高德服务发起请求，携带你的<b>公网 IP</b>与<b>你主动输入的搜索关键词</b>；地图 SDK 会在本机产生会话标识（如 sessionId、定位相关标识）用于地图交互。足迹坐标本身（名称、日期、经纬度）<b>仅保存在本机</b>，不会提交给高德。地图 Key 由你在设置中自行配置，我们不代为托管。</li>
        <li><b>大模型 API（OpenAI 兼容接口）</b>：用于「AI 中枢」与主页速览的意图识别。请求时，<b>你输入的文本内容</b>会发送至你在「设置 → AI 对话」中填写的 Base URL；API Key 仅存于本机，仅作为鉴权头随请求发送，<b>不会写入导出文件、不会同步到 WebDAV、不会显示在界面上</b>。若你填写的是第三方服务商的地址，则该服务商的数据处理规则同时适用，请自行选择可信赖的服务方。</li>
        <li><b>Steam API（Valve）</b>：用于「Steam 游戏库」拉取游戏列表。仅在你填写 SteamID / API Key 并点击拉取时发起请求，携带你填写的 <b>SteamID 与 API Key</b>；返回的游戏库数据缓存在本机。Steam Key 不会随应用数据导出或同步。你也可以配置自建代理地址，此时数据流向由该代理决定。</li>
        <li><b>WebDAV 服务器</b>：用于备份与跨端同步。请求会携带你在设置中填写的服务器地址与账号密码，以及你主动上传的完整数据备份。备份文件加密与否取决于你的服务器配置，地球Online 不会额外留存副本。</li>
        <li><b>静态资源与 PWA</b>：应用为纯静态站点，图标、脚本等资源从发布方托管地址加载，这是一次普通的网络请求，会暴露你的 IP 与浏览器信息给托管方（如同访问任何网站）。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">三、你的控制权</div>
      <ul class="plist">
        <li>所有第三方功能均可<b>随时不填凭据、不启用</b>；不配置即完全离线可用。</li>
        <li>凭据（AI Key、Steam Key、WebDAV 密码）保存在本机，可随时在设置中清空。</li>
        <li>导出备份时可选择是否包含 AI / Steam 配置；导出文件默认完整保留你选择导出的字段。</li>
        <li>你可以通过浏览器设置清除站点数据、撤销授权或使用隐私模式运行。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">四、我们不会做什么</div>
      <ul class="plist">
        <li>不上传、不收集、不出售你的任何个人生活数据。</li>
        <li>无第三方统计 SDK、无广告、无追踪器、无用户画像。</li>
        <li>不读取与本应用无关的本地文件、剪贴板历史或通讯录。</li>
        <li>不向任何第三方提供你的凭据用于其自有目的。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">五、未成年人</div>
      <div style="font-size:14px;line-height:1.8">本应用不面向 13 周岁以下儿童设计，也不会主动收集个人信息。若你不满相关法定年龄，请在监护人陪同下使用。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">六、政策变更</div>
      <div style="font-size:14px;line-height:1.8">本政策如有更新，会在「设置 → 关于 → 更新日志」中同步说明版本与日期。政策变更不会追溯影响已保存在本机的数据。</div>
    </div>
  </div>
</template>

<style scoped>
.plist { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.9; }
.plist li { margin-bottom: 6px; }
</style>
