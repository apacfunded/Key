// Etch grinder worker. Runs entirely in the user's browser. The secret never leaves this device.
importScripts('/ed-core.js');
onmessage = (e) => {
  const m = e.data;
  if (m.type !== 'start') return;
  let tried = 0, last = performance.now();
  self.EtchEd.grind(m.targets,
    (r) => postMessage({ type: 'found', ...r }),
    (n) => {
      tried += n;
      const now = performance.now();
      if (now - last > 250) { postMessage({ type: 'progress', tried }); tried = 0; last = now; }
      return true;
    });
};
