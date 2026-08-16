/**
 * SingleFlight
 *
 * Deduplicates concurrent asynchronous work keyed by an operation id.
 * If an operation with the same key is already in flight, subsequent callers
 * share the same pending promise instead of firing a duplicate request.
 * Used for: lazy module loading, AI request dedup, analysis, persistence.
 */

interface InFlight<T> {
    promise: Promise<T>;
}

export class SingleFlight {
    private readonly flights = new Map<string, InFlight<unknown>>();

    run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const existing = this.flights.get(key) as InFlight<T> | undefined;
        if (existing) return existing.promise;

        const flight: InFlight<T> = { promise: Promise.resolve().then(task) };
        this.flights.set(key, flight as InFlight<unknown>);

        flight.promise.then(
            () => this.flights.delete(key),
            () => this.flights.delete(key),
        );

        return flight.promise;
    }

    /** Remove any in-flight op for a key so the next run() starts fresh. */
    clear(key: string): void {
        this.flights.delete(key);
    }

    clearAll(): void {
        this.flights.clear();
    }

    get size(): number {
        return this.flights.size;
    }
}
