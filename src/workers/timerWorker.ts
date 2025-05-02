
// Using `as any` for self because TypeScript's Worker typings can be tricky
const ctx: Worker = self as any;

let timerId: number | null = null;
let bpm = 120;
let swing = 0; // 0-100, represents percentage delay for even steps
let step = 0;
let interval = (60 / bpm / 4) * 1000; // Interval for 16th notes in ms
let expectedTime = 0;

function calculateInterval() {
  interval = (60 / bpm / 4) * 1000; // PPQN (Pulse Per Quarter Note) is usually 24 or higher, here we use 4 for 16th notes
}

function scheduleTick() {
    const now = performance.now();
    let delay = interval;

    // Apply swing: Delay the even steps (1, 3, 5, ...)
    // Swing = 50% means even steps are exactly halfway between odd steps (no swing)
    // Swing > 50% delays even steps
    // Swing = 66% is typical triplet swing
    // Swing = 75% is hard swing
     const swingRatio = swing / 100; // 0.0 to 1.0
     const isEvenStep = step % 2 !== 0; // Steps 1, 3, 5... (0-indexed: 1, 3, 5...)

     if (swing > 0 && isEvenStep) {
        // The amount of the *next* interval that belongs to the *current* step's duration
        // Standard interval assumes 50%
         const swingDelayFactor = (swingRatio - 0.5) * 2; // Map 0.5-1.0 to 0-1.0
         delay += interval * swingDelayFactor;
     } else if (swing > 0 && !isEvenStep) {
         // Shorten the odd steps if swing is applied
         const swingShortenFactor = (0.5 - swingRatio) * 2; // Map 0.0-0.5 to 1.0-0.0 (how much to shorten)
         delay -= interval * swingShortenFactor;
     }


    // Self-adjusting timer correction
    const drift = now - expectedTime;
    // console.log(`Drift: ${drift.toFixed(2)}ms`);

    // Don't over-correct; adjust gradually or ensure delay isn't negative
    let nextTickDelay = Math.max(0, delay - drift);

    timerId = setTimeout(tick, nextTickDelay);
    expectedTime += delay; // Update expected time based on the *intended* delay
}


function tick() {
  // Post message back to the main thread with the current step
  ctx.postMessage({ type: 'tick', step: step });

  // Increment step and wrap around
  step = (step + 1) % 16; // 16 steps per pattern

  // Schedule the next tick
  scheduleTick();
}

ctx.onmessage = (e: MessageEvent) => {
  const { cmd, value } = e.data;

  switch (cmd) {
    case 'start':
      console.log('Worker: Start received');
      if (timerId === null) {
        step = 0; // Reset step count
        expectedTime = performance.now(); // Initialize expected time
        scheduleTick(); // Start the timer loop
      }
      break;
    case 'stop':
       console.log('Worker: Stop received');
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      step = 0; // Reset step on stop
      break;
    case 'bpm':
       // console.log('Worker: BPM update received', value);
       if (typeof value === 'number' && value > 0) {
         bpm = value;
         calculateInterval();
          // If running, we might need to adjust the *next* timeout based on new interval
          // This simple version just uses the new interval for the next scheduled tick
       }
      break;
     case 'swing':
       // console.log('Worker: Swing update received', value);
       if (typeof value === 'number' && value >= 0 && value <= 100) {
           swing = value;
           // Interval calculation doesn't change, but scheduleTick logic does
       }
      break;
    default:
      console.log('Worker: Unknown command received', cmd);
  }
};
