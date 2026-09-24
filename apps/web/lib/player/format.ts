/** `m:ss`, or `h:mm:ss`; whole seconds rounded down, so the display never runs ahead. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '–:––';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** "1 minute 23 seconds of 4 minutes 56 seconds", for the seek slider's spoken value. */
export function spokenPosition(position: number, duration: number | null): string {
  const say = (value: number) => {
    const total = Math.floor(value);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    const parts = [];
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
    return parts.join(' ');
  };
  return duration === null ? say(position) : `${say(position)} of ${say(duration)}`;
}
