<script setup>
// 内联矢量图标集（替代 emoji）。name 对应 SVG path 数据。
const props = defineProps({ name: { type: String, required: true }, size: { type: [Number, String], default: 22 } })
const P = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  tasks: 'M9 4h11M9 12h11M9 20h11M4 4h.01M4 12h.01M4 20h.01',
  checklist: 'M3 6l2 2 3-3M3 14l2 2 3-3M14 6h7M14 14h7',
  backpack: 'M6 8a6 6 0 0 1 12 0v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8zM9 8V6a3 3 0 0 1 6 0v2',
  note: 'M5 4h14v16l-4-4h-6l-4 4V4zM8 9h8M8 13h5',
  album: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z',
  wallet: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM16 12h4M4 9h16',
  chart: 'M4 20V10M10 20V4M16 20v-8M21 20H3',
  bell: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3',
  file: 'M6 3h8l4 4v14H6V3zM14 3v4h4M9 12h6M9 16h6',
  music: 'M9 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 16a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM11.5 15.5V6l9-2v10',
  video: 'M3 6h12v12H3V6zM15 10l6-3v10l-6-3',
  link: 'M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  coins: 'M12 8c4.4 0 8-1.1 8-2.5S16.4 3 12 3 4 4.1 4 5.5 7.6 8 12 8zM4 5.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5M4 10.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5',
  chevdown: 'M6 9l6 6 6-6',
  minus: 'M5 12h14',
  quote: 'M7 7h4v4c0 3-1 5-4 6M14 7h4v4c0 3-1 5-4 6',
  'map-pin': 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  sparkles: 'M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2zM18 14l.9 2.4L21 17l-2.1.6L18 20l-.9-2.4L15 17l2.1-.6L18 14z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 20h6M10 16v4M14 16v4',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.8 6.6 20l1-6.1L3.2 9.5l6.1-.9L12 3z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  x: 'M6 6l12 12M18 6L6 18',
  send: 'M4 12l16-8-6 16-3-7-7-1z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  tag: 'M3 12l9-9 9 9-9 9-9-9zM8 8h.01',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-1 1.5-2a1.5 1.5 0 0 1 3 0 1.5 1.5 0 0 0 3 0 9 9 0 0 0-16.5-7c2-2 4-3 5.5-3 1 0 1.5 1 1.5 2a1.5 1.5 0 0 0 3 0c0-1.2-1-2-1.5-2z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  cloud: 'M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 18 18H7z',
  download: 'M12 3v12M7 11l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 13l5-5 5 5M5 4h14',
  heart: 'M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z',
  egg: 'M12 3a7 7 0 1 0 0 18 7 7 0 0 0 0-18z',
  medal: 'M8 4l4 7 4-7M12 11a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  cake: 'M4 21h16v-2H4zM5 17h14l-1-5H6l-1 5zM8 12V9a2 2 0 0 1 4 0M14 12V9a2 2 0 0 1 4 0',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  location: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z',
  chevron: 'M9 6l6 6-6 6',
  flag: 'M5 21V4M5 4h12l-3 4 3 4H5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  bolt: 'M13 3L4 14h7l-1 7 9-11h-7l1-7z',
  gift: 'M20 12v9H4v-9M2 8h20v4H2zM12 8v12M12 8S10 3 7 5s2 3 5 3M12 8s2-3 5-3-2 3-5 3',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM19 19H6',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  // —— 空状态 / 对话框矢量插画（替代 emoji） ——
  gamepad: 'M6 9h12a3 3 0 0 1 3 3v1a2 2 0 0 1-3.4 1.4L16 13H8l-1.6.4A2 2 0 0 1 4 13v-1a3 3 0 0 1 2-3zM8 11.5v3M6.8 13h2.4M16 11.5h.01M18 13.5h.01',
  sprout: 'M12 22V11M12 11C12 8 10 6 7 6a3 3 0 0 0 0 5c2 0 3-1 3-2M12 9c0-3 2-5 5-5a3 3 0 0 1 0 5c-2 0-3-1-3-2',
  coffee: 'M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9zM16 10h2.5a2.5 2.5 0 0 1 0 5H16M8 5c0-1 .8-1.4.8-2.4M11 5c0-1 .8-1.4.8-2.4M14 5c0-1 .8-1.4.8-2.4',
  check: 'M5 12l4 4 10-11',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  warning: 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01'
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="P[props.name] || P.spark" />
  </svg>
</template>
