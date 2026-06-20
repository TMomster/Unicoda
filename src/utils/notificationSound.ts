/** 播放系统通知音效（用 Web Audio API 合成一段短促的提示音） */
export function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    // 两声短促的弹拨音：第一声较高，第二声稍低
    const notes = [880, 660]; // A5 → E5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });

    // 自动释放 AudioContext
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // 浏览器限制 AudioContext 时静默忽略
  }
}
