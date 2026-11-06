<script setup>
// ===== 空间切换 3D 过渡 =====
// 「物理文件夹」展开：盖板抬起 → 内页浮现 → 画布缩放入场。
// 低端设备（lite）直接降级为 240ms 的纸面淡入，不跑 3D 变换。
defineProps({
  fx: { type: Object, default: null },
  lite: { type: Boolean, default: false }
})
</script>

<template>
  <div v-if="fx && fx.active" class="fx" :class="{ lite }" :key="fx.key">
    <div class="fx-scrim"></div>
    <div class="fx-scene">
      <div class="folder">
        <div class="folder-shadow"></div>
        <div class="folder-back"></div>
        <div class="folder-paper">
          <span class="paper-kicker">SPACE</span>
          <span class="paper-name">{{ fx.name }}</span>
          <span class="paper-rule"></span>
          <span class="paper-meta">{{ fx.meta || '画布视口恢复中' }}</span>
        </div>
        <div class="folder-front"></div>
        <div class="folder-lid"><span class="folder-tab"></span></div>
      </div>
      <div class="fx-caption">{{ fx.caption || '正在展开空间' }}</div>
    </div>
  </div>
</template>

<style scoped>
.fx { position: absolute; inset: 0; z-index: 70; pointer-events: none; }
.fx-scrim {
  position: absolute; inset: 0; background: rgba(250,249,246,0.9);
  animation: scrimIn .5s ease forwards;
}
.fx-scene {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  perspective: 1100px; animation: sceneOut .7s cubic-bezier(.22,.9,.24,1) forwards;
}
.folder {
  position: relative; width: 256px; height: 168px;
  transform-style: preserve-3d;
  animation: folderIn .62s cubic-bezier(.2,.85,.24,1) both;
}
.folder-shadow {
  position: absolute; left: 12%; right: 12%; bottom: -26px; height: 34px;
  background: radial-gradient(ellipse at center, rgba(44,44,44,0.16), rgba(44,44,44,0));
  filter: blur(6px);
}
.folder-back {
  position: absolute; inset: 12px 0 0 0; background: #E7E1D3;
  border-radius: 10px 14px 14px 14px; border: 1px solid rgba(44,44,44,0.10);
}
.folder-paper {
  position: absolute; left: 14px; right: 14px; top: 18px; height: 120px;
  background: #FFFFFF; border: 1px solid rgba(44,44,44,0.10); border-radius: 8px;
  padding: 18px 18px; display: flex; flex-direction: column; gap: 7px;
  animation: paperUp .7s cubic-bezier(.2,.85,.24,1) both;
  box-shadow: 0 12px 24px -16px rgba(44,44,44,0.4);
}
.paper-kicker { font-size: 9px; letter-spacing: .22em; font-weight: 800; color: #A29D93; }
.paper-name { font-size: 17px; font-weight: 800; color: #2C2C2C; line-height: 1.25; }
.paper-rule { width: 26px; height: 2px; background: #E8B86D; border-radius: 2px; }
.paper-meta { font-size: 10.5px; color: #8A867E; }
.folder-front {
  position: absolute; left: -6px; right: -6px; bottom: -2px; height: 96px;
  background: #EFE9DB; border-radius: 8px 10px 18px 18px;
  border: 1px solid rgba(44,44,44,0.10);
  transform: translateZ(26px);
  box-shadow: 0 -8px 20px -14px rgba(44,44,44,0.28);
}
.folder-lid {
  position: absolute; left: -2px; right: -2px; top: -4px; height: 74px;
  background: #E3DBC9; border: 1px solid rgba(44,44,44,0.10);
  border-radius: 12px 12px 8px 8px;
  transform-origin: bottom center;
  transform-style: preserve-3d;
  animation: lidOpen .72s cubic-bezier(.4,.1,.2,1) both;
  display: flex; justify-content: flex-end; padding: 10px;
}
.folder-tab {
  width: 62px; height: 12px; border-radius: 6px; background: #D6CBB4;
  margin-top: -16px; margin-right: 12px;
}
.fx-caption {
  position: absolute; bottom: 16%; left: 0; right: 0; text-align: center;
  font-size: 11px; letter-spacing: .18em; color: #9C978E; text-transform: uppercase;
}
@keyframes scrimIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes sceneOut { 0%, 62% { opacity: 1 } 100% { opacity: 0 } }
@keyframes folderIn {
  0% { transform: scale(0.86) rotateX(18deg); opacity: 0 }
  45% { transform: scale(1.02) rotateX(6deg); opacity: 1 }
  100% { transform: scale(1.06) rotateX(0deg); opacity: 1 }
}
@keyframes lidOpen {
  0% { transform: rotateX(0deg) translateZ(0) }
  55% { transform: rotateX(-102deg) translateZ(4px) }
  100% { transform: rotateX(-118deg) translateZ(6px); opacity: .9 }
}
@keyframes paperUp {
  0% { transform: translateY(16px) scale(.97); opacity: 0 }
  55% { opacity: 1 }
  100% { transform: translateY(-12px) scale(1.01); opacity: 1 }
}
/* 低端设备：240ms 纸面淡入，无 3D */
.fx.lite .fx-scene { animation: liteOut .3s ease forwards; perspective: none; }
.fx.lite .folder { animation: none; transform: none; opacity: 1; }
.fx.lite .folder-lid { animation: none; transform: none; }
.fx.lite .folder-paper { animation: none; }
.fx.lite .folder-front, .fx.lite .folder-back, .fx.lite .folder-shadow { display: none; }
.fx.lite .fx-caption { display: none; }
.fx.lite .fx-scrim { background: rgba(250,249,246,0.94); }
@keyframes liteOut { 0%,70% { opacity: 1 } 100% { opacity: 0 } }
/* 深色主题：文件夹与内页跟随暗色，避免开场白块 */
:global([data-theme='dark'] .fx-scrim) { background: rgba(20,20,22,0.92); }
:global([data-theme='dark'] .folder-back),
:global([data-theme='dark'] .folder-front),
:global([data-theme='dark'] .folder-lid),
:global([data-theme='dark'] .folder-tab) { background: #2A2A2E; border-color: var(--sp-line, rgba(255,255,255,.12)); }
:global([data-theme='dark'] .folder-paper) { background: var(--sp-card, #1E1E21); border-color: var(--sp-line, rgba(255,255,255,.12)); }
:global([data-theme='dark'] .paper-kicker),
:global([data-theme='dark'] .paper-meta) { color: var(--sp-ink-3, #7A766F); }
:global([data-theme='dark'] .paper-name) { color: var(--sp-ink, #EDEBE7); }
:global([data-theme='dark'] .fx-caption) { color: var(--sp-ink-2, #A6A29A); }
:global([data-theme='dark'] .fx.lite .fx-scrim) { background: rgba(20,20,22,0.94); }
@media (max-width: 640px) {
  .folder { width: 210px; height: 140px; }
  .folder-paper { height: 100px; }
  .paper-name { font-size: 15px; }
}
</style>
