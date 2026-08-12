import { useEffect, useState } from 'react';
import { subscribeCollection } from './storage.js';

// Read a collection so the screen follows it, instead of photographing it once.
//
// Reads stay synchronous — `read` is called during the first render exactly as
// `useState(getSessionHistory)` used to be, so nothing waits on a round trip
// and the first paint is identical. The difference is what happens afterwards:
// when the value changes underneath us the component re-reads and re-renders.
//
// "Underneath us" is mostly cloud sync. Signing in on a new device pulls your
// history down and writes it to local storage, and without this the pages
// carry on rendering the empty snapshot they took at mount — the data is
// sitting on disk while the screen says you have never trained.
//
// `read` must be a stable function reference (the module-level getters in
// db.js are); an inline arrow would resubscribe on every render.

export function useCollection(collection, read) {
  const [value, setValue] = useState(read);

  useEffect(() => {
    // Re-read once on subscribe as well as on change: a sync that completed
    // between this component's first render and its effect running would
    // otherwise go unnoticed until the next write.
    setValue(read());
    return subscribeCollection(collection, () => setValue(read()));
  }, [collection, read]);

  return value;
}
