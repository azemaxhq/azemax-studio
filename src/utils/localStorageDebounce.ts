// Coalesced localStorage writes: rapid state changes batch into a single
// write at idle time, so the main thread isn't blocked per keystroke/render.
// A flush-on-hide/unload guarantees no data is lost, and identical values
// (same serialized string as the last actual write) are skipped entirely.

export {
    debouncedLocalStorageSet,
    flushLocalStorage,
    clearDebounceCache,
    immediateLocalStorageSet,
} from '../core/storage/storageDebounce';
