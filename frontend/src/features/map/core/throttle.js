// Minimal leading+trailing throttle (replaces lodash/throttle).
export default function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  const throttled = function (...args) {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn.apply(this, args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, pendingArgs);
        }, remaining);
      }
    }
  };
  throttled.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return throttled;
}
