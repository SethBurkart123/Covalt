// Internal bridge utilities - do not modify
let _baseUrl: string | null = null;

export interface BridgeError {
    code: string;
    message: string;
    details?: unknown;
}

export class BridgeRequestError extends Error {
    code: string;
    details?: unknown;

    constructor(error: BridgeError) {
        super(error.message);
        this.name = "BridgeRequestError";
        this.code = error.code;
        this.details = error.details;
    }
}

export interface BridgeChannel<T> {
    subscribe(callback: (data: T) => void): void;
    onError(callback: (error: BridgeError) => void): void;
    onClose(callback: () => void): void;
    close(): void;
}

export function initBridge(baseUrl: string): void {
    _baseUrl = baseUrl.replace(/\/$/, "");
    console.log(`[Zynk] Initialized with base URL: ${_baseUrl}`);
}

export function getBaseUrl(): string {
    if (!_baseUrl) {
        throw new Error(
            "[Zynk] Bridge not initialized. Call initBridge(url) first."
        );
    }
    return _baseUrl;
}

export async function request<T>(command: string, args: unknown): Promise<T> {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/command/${command}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
    });

    const data = await response.json();

    if (!response.ok) {
        throw new BridgeRequestError({
            code: data.code || "UNKNOWN_ERROR",
            message: data.message || "An unknown error occurred",
            details: data.details,
        });
    }

    return data.result as T;
}

export function createChannel<T>(command: string, args: unknown): BridgeChannel<T> {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/channel/${command}`;

    let abortController: AbortController | null = new AbortController();
    let messageCallback: ((data: T) => void) | null = null;
    let errorCallback: ((error: BridgeError) => void) | null = null;
    let closeCallback: (() => void) | null = null;

    const startStream = async () => {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
                signal: abortController?.signal,
            });

            if (!response.ok) {
                const data = await response.json();
                errorCallback?.({
                    code: data.code || "CHANNEL_ERROR",
                    message: data.message || "Failed to start channel",
                    details: data.details,
                });
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
                errorCallback?.({ code: "NO_STREAM", message: "Response has no body" });
                return;
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split("\n\n");
                buffer = events.pop() || "";

                for (const eventBlock of events) {
                    if (!eventBlock.trim()) continue;

                    let eventType = "message";
                    let eventData = "";

                    for (const line of eventBlock.split("\n")) {
                        if (line.startsWith("event: ")) {
                            eventType = line.slice(7);
                        } else if (line.startsWith("data: ")) {
                            eventData = line.slice(6);
                        }
                    }

                    if (eventType === "error") {
                        const parsed = JSON.parse(eventData);
                        errorCallback?.({
                            code: "STREAM_ERROR",
                            message: parsed.error || "Stream error",
                        });
                    } else if (eventType === "close") {
                        closeCallback?.();
                    } else if (eventData) {
                        const parsed = JSON.parse(eventData);
                        messageCallback?.({ event: eventType, ...parsed } as T);
                    }
                }
            }

            closeCallback?.();
        } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") return;
            errorCallback?.({
                code: "STREAM_ERROR",
                message: err instanceof Error ? err.message : "Unknown error",
            });
        }
    };

    startStream();

    return {
        subscribe(callback: (data: T) => void): void {
            messageCallback = callback;
        },
        onError(callback: (error: BridgeError) => void): void {
            errorCallback = callback;
        },
        onClose(callback: () => void): void {
            closeCallback = callback;
        },
        close(): void {
            abortController?.abort();
            abortController = null;
        },
    };
}
