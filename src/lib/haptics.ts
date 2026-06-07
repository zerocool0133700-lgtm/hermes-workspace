export function hapticTap() {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(8)
    }
  } catch {}
}
