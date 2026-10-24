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
      <div class="muted" style="font-size:12px;margin-top:4px">更新于 2026-10-24 · 适用版本 v1.0.6（Web 端）</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">一句话总结</div>
      <div style="font-size:14px;line-height:1.8">地球Online 是一个<b>完全离线运行</b>的个人生活记录应用：没有服务器、没有账号体系、没有埋点统计。你的每一条数据都只存在于这台设备的浏览器中。</div>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">数据存储</div>
      <ul class="plist">
        <li>所有记录（任务 / 笔记 / 相册 / 足迹 / 记账等）保存在本机 <b>IndexedDB</b>，偏好设置保存在本机 <b>localStorage</b>。</li>
        <li>清除浏览器站点数据 = 永久删除全部数据，请先在「设置 → 导出备份」做好备份。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">网络请求</div>
      <ul class="plist">
        <li>日常使用<b>不产生任何网络请求</b>。以下功能按需发起且仅你主动触发：</li>
        <li>「云端 AI」：仅在你配置了 API 地址与密钥并主动发送消息时，向该地址直连请求，密钥只存本机。</li>
        <li>「Steam 游戏库」：仅在你填写 Key/ID 并点击拉取时，向 Steam API（或你填写的代理）请求。</li>
        <li>「地图」：加载高德地图 JS SDK 与地点搜索；足迹坐标保存在本机。</li>
        <li>「WebDAV 同步」：仅向你填写的服务器地址上传/下载数据。</li>
      </ul>
    </div>

    <div class="glass card">
      <div style="font-weight:700;margin-bottom:6px">我们不会做什么</div>
      <ul class="plist">
        <li>不上传、不收集、不出售你的任何数据。</li>
        <li>无第三方统计 SDK、无广告、无追踪器。</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.plist { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.9; }
</style>
