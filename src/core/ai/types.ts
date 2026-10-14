/**
 * Shared types for the central AI runtime.
 */

import type { AIError } from './AIError';

export type AiTaskKey =
    | 'chat'
    | 'simple_edit'
    | 'explanation'
    | 'complex_code'
    | 'autocomplete'
    | 'comment'
    | 'fast_chat'
    | 'deep_reasoning';

export type ResponseLength = 'short' | 'medium' | 'long';

// ---------------------------------------------------------------------------
// Native tool-calling protocol (OpenAI-compatible `tools` / `tool_calls`).
//
// These types are the SINGLE wire contract shared by AIClient, the backend
// `/ai/chat` route, and the agent loop. Provider-specific quirks stay inside
// the provider abstraction; everything above it speaks this shape.
// ---------------------------------------------------------------------------

/** A single tool invocation requested by the model. */
export interface AIToolCall {
    /** Provider-assigned id, echoed back on the matching `tool` message. */
    id: string;
    type: 'function';
    function: {
        name: string;
        /**
         * Raw JSON string exactly as emitted by the provider. It is NEVER
         * parsed by regex/prose heuristics — `parseToolArguments` uses
         * `JSON.parse` and treats malformed JSON as an invalid call.
         */
        arguments: string;
    };
}

/** JSON Schema subset accepted for tool parameters. */
export interface AIToolParameters {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface AIToolDefinition {
    type: 'function';
    function: {
        /** Stable identifier used for dispatch. Never model-generated. */
        name: string;
        description: string;
        parameters: AIToolParameters;
    };
}

export type AIToolChoice = 'auto' | 'none' | 'required';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    /** Always a string — `tool` messages carry the serialized result here. */
    content: string;
    /** Present on assistant messages that requested tools. */
    tool_calls?: AIToolCall[];
    /** Present on `tool` messages — the id of the call being answered. */
    tool_call_id?: string;
    /** Tool name on `tool` messages (OpenAI-compatible echo). */
    name?: string;
}

export interface AIRequestOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /** Backend task key — routes to the Nemotron reasoning profile. */
    task?: AiTaskKey;
    /**
     * When false, the request uses ONLY the requested model — no provider
     * fallback chain (used by low-latency paths like autocomplete so a
     * suggestion never waits on known-unavailable providers).
     */
    allowFallback?: boolean;
    /**
     * Tool definitions exposed to the model. Omitted for every non-agent
     * feature, so chat/explain/autocomplete behavior is byte-identical to
     * before tool calling existed.
     */
    tools?: AIToolDefinition[];
    /** Defaults to `auto` when tools are supplied. */
    toolChoice?: AIToolChoice;
}

export interface AIRequestContext {
    responseLength?: ResponseLength;
    /** Dev-only: elapsed ms spent building the prompt context before transport. */
    contextBuildMs?: number;
}

/** Provider-reported token usage (OpenAI-compatible). */
export interface AIUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
        reasoning_tokens?: number;
    };
}

/**
 * Normalized stream event emitted by `AIClient.streamChat`.
 * `reasoning` is ALWAYS kept separate from `delta` — consumers that render
 * user-visible answers must ignore `reasoning`.
 */
export type AIStreamEvent =
    | { type: 'start'; model: string }
    | { type: 'model'; model: string }
    | { type: 'delta'; content: string }
    | { type: 'reasoning'; content: string }
    /** Normalized native tool calls accumulated from the response. */
    | { type: 'tool_calls'; calls: AIToolCall[] }
    | { type: 'done'; model?: string; usage?: AIUsage; finishReason?: string }
    | {
          type: 'error';
          message: string;
          details?: string;
          /** Typed error code (see AI_ERROR_CODES) — never the raw developer text. */
          code?: string;
          provider?: string;
          retryable?: boolean;
      };

/**
 * Discriminated union for non-streaming AI results. The editor write path and
 * chat UI must switch on `ok`: only `{ ok: true, content }` may reach the
 * sanitizer → validator → Monaco pipeline. Provider failures are carried as a
 * typed AIError, never as generated text.
 */
export type AIResult =
    | {
          ok: true;
          content: string;
          model?: string;
          provider?: string;
          usage?: AIUsage;
          requestId?: string;
          /** Structured tool calls requested by the model (empty when none). */
          toolCalls?: AIToolCall[];
          finishReason?: string;
      }
    | { ok: false; error: AIError };

/**
 * Provider-independent normalized AI response.
 * Every provider (NVIDIA, Kilo Code, Groq, etc.) must be normalized to this type
 * before reaching the rest of the application.
 */
export interface AIResponse {
    content: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    finishReason?: string;
    provider: string;
    model: string;
}

export interface RuntimeMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'pending' | 'streaming' | 'complete' | 'stopped' | 'error';
}

export type TaskType = 'chat' | 'code-gen' | 'explain' | 'fix' | 'refactor' | 'inline-suggest';

export interface ProjectContext {
    fileStructure?: string;
    openFiles?: { name: string; content: string }[];
    activeFile?: { name: string; content: string };
}