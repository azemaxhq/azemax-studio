import type { ChatMessage, ChatOptions } from './groqService';
import type { Settings } from '../types/settings';
import { API_BASE } from './apiClient';

export interface BackendModel {
    id: string;
    provider: string;
    label: string;
}

const useBackend = import.meta.env.VITE_USE_BACKEND_AI !== 'false';

export const isBackendAiEnabled = () => useBackend;

type SseEvent = { type: string; content?: string; message?: string; details?: string; model?: string };

function parseSseBlock(block: string): SseEvent[] {
    const events: SseEvent[] = [];

    for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
            events.push({ type: 'done' });
            continue;
        }
        try {
            events.push(JSON.parse(payload));
        } catch {
            /* ignore malformed event */
        }
    }

    return events;
}

async function readErrorBody(response: Response): Promise<string> {
    try {
        const body = await response.json();
        if (body.details) return `${body.error}: ${body.details}`;
        return body.error || response.statusText;
    } catch {
        return response.statusText;
    }
}

export async function fetchBackendModels(): Promise<BackendModel[]> {
    const response = await fetch(`${API_BASE}/ai/models`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.models || [];
}

export async function sendBackendChat(
    messages: ChatMessage[],
    options: ChatOptions = {},
    settings?: Settings,
): Promise<string> {
    const response = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
            messages,
            model: options.model,
            temperature: options.temperature,
            responseLength: settings?.ai.responseLength || 'medium',
            stream: false,
        }),
    });

    if (!response.ok) {
        throw new Error(await readErrorBody(response));
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

export async function* streamBackendChat(
    messages: ChatMessage[],
    options: ChatOptions = {},
    settings?: Settings,
): AsyncGenerator<string, void, unknown> {
    const response = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
            messages,
            model: options.model,
            temperature: options.temperature,
            responseLength: settings?.ai.responseLength || 'medium',
            stream: true,
        }),
    });

    if (!response.ok) {
        throw new Error(await readErrorBody(response));
    }

    if (!response.body) {
        throw new Error('AI stream returned an empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedToken = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            for (const event of parseSseBlock(block)) {
                if (event.type === 'token' && event.content) {
                    receivedToken = true;
                    yield event.content;
                } else if (event.type === 'error') {
                    const detail = event.details ? `: ${event.details}` : '';
                    throw new Error(`${event.message || 'Stream error'}${detail}`);
                } else if (event.type === 'done') {
                    return;
                }
            }

            boundary = buffer.indexOf('\n\n');
        }
    }

    if (buffer.trim()) {
        for (const event of parseSseBlock(buffer)) {
            if (event.type === 'token' && event.content) {
                receivedToken = true;
                yield event.content;
            } else if (event.type === 'error') {
                const detail = event.details ? `: ${event.details}` : '';
                throw new Error(`${event.message || 'Stream error'}${detail}`);
            }
        }
    }

    if (!receivedToken) {
        throw new Error('AI stream ended without any content');
    }
}
