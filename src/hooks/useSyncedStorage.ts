import { useState, useEffect, useCallback, useRef } from 'react';
import type { z } from 'zod';
import { StorageManager, type StorageOptions } from '../core/storage/storageManager';
import { safeValidateWithSchema } from '../core/storage/storageSchema';

/**
 * React hook for LocalStorage with automatic synchronization across
 * components and browser tabs, type safety with optional Zod schema,
 * and debounced writes.
 */
export function useSyncedStorage<T>(
    key: string,
    initialValue: T,
    schema?: z.ZodType<T>,
    options?: StorageOptions
): [T, (valOrUpdater: T | ((prev: T) => T)) => void] {
    const schemaRef = useRef(schema);
    useEffect(() => {
        schemaRef.current = schema;
    }, [schema]);

    const [value, setValue] = useState<T>(() => {
        const stored = StorageManager.get<T>(key, schema);
        return stored !== null ? stored : initialValue;
    });

    // Listen for storage changes from other components or tabs
    useEffect(() => {
        const unsubscribe = StorageManager.subscribe(key, (newRawValue) => {
            if (newRawValue === null) {
                setValue(initialValue);
                return;
            }
            try {
                let parsed: unknown = newRawValue;
                try {
                    parsed = JSON.parse(newRawValue);
                } catch {
                    parsed = newRawValue;
                }
                if (schemaRef.current) {
                    setValue(safeValidateWithSchema(schemaRef.current, parsed, initialValue));
                } else {
                    setValue(parsed as T);
                }
            } catch {
                setValue(initialValue);
            }
        });
        return unsubscribe;
    }, [key, initialValue]);

    const setStoredValue = useCallback(
        (valOrUpdater: T | ((prev: T) => T)) => {
            setValue((prev) => {
                const next = typeof valOrUpdater === 'function'
                    ? (valOrUpdater as (prev: T) => T)(prev)
                    : valOrUpdater;
                StorageManager.set(key, next, options);
                return next;
            });
        },
        [key, options]
    );

    return [value, setStoredValue];
}
