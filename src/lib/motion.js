// Spring animation presets — ported from wxbuddy/lib/motion.ts (Framer Motion)
// Reused via motion-v (the official Framer Motion port for Vue). Same physics.

export const easeOutExpo = [0.22, 1, 0.36, 1]

// Soft spring — page rises, cards settle
export const springSoft = { type: 'spring', stiffness: 320, damping: 28, mass: 0.85 }
// Snappy spring — buttons, nav taps, icon wells
export const springSnappy = { type: 'spring', stiffness: 420, damping: 26, mass: 0.7 }
// Modal panel — heavier, deliberate lift
export const springModal = { type: 'spring', stiffness: 360, damping: 26, mass: 0.8 }

// Route / page transition: opacity + y + scale + blur (the wxbuddy signature)
export const routeVariants = {
  initial: { opacity: 0, y: 18, scale: 0.985, filter: 'blur(10px)' },
  animate: {
    opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
    transition: springSoft
  },
  exit: {
    opacity: 0, y: -14, scale: 0.99, filter: 'blur(8px)',
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] }
  }
}

// Inner pop (dialog content blocks)
export const popVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.15 } }
}

// Stagger container + item (list / grid entrance)
export const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } }
}
export const staggerItem = {
  hidden: { opacity: 0, y: 10, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.32, ease: easeOutExpo } }
}
