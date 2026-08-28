// Centralized per-task AI profiles, tuned for NVIDIA DeepSeek V4 Flash 0731 (premium + efficient)
// Primary model: deepseek-ai/deepseek-v4-flash-0731 via https://integrate.api.nvidia.com/v1
// User requested: temperature=1, top_p=0.95, max_tokens=16384, thinking=true, reasoning_effort=high
// Flash = efficient (low latency), high reasoning = premium quality. Fallbacks handled by modelRouter.
//
//   chat_template_kwargs.enable_thinking  -> reasoning trace on/off (documented)
//   reasoning_effort                     -> none | low | high (live verified on hosted endpoint)
//   chat_template_kwargs.medium_effort   -> DEPRECATED: flaky on hosted API (intermittent 503)
//   chat_template_kwargs.force_nonempty_content -> required for coding-agent
//     tool-calling paths on some backends (SGLang). The hosted API does not
//     require it for plain chat and can reject it, so it stays OFF unless
//     NVIDIA_FORCE_NONEMPTY=true is configured (see modelRouter.cjs).
//
// NOTE (verified live 2026-08): the HOSTED NVIDIA API 500s/400s on ANY payload that
// includes `reasoning_budget`, so budgets are intentionally NOT configured here.
// `reasoning_effort` + `enable_thinking` is the authoritative reasoning control.
// `medium_effort` is removed due to unreliable 503 responses on the hosted endpoint.
//
// Profiles are the single source of truth for temperature / max tokens /
// reasoning controls.
//
// PER-TASK REASONING POLICY (task-aware, deterministic):
//   autocomplete / inline_completion -> reasoning OFF (latency-critical)
//   comment                          -> reasoning OFF (one-line rewrites)
//   simple_edit / simple code        -> reasoning OFF
//   simple chat                      -> reasoning OFF
//   fast_chat                        -> reasoning OFF
//   explanation                      -> reasoning OFF
//   complex_code (debug/refactor)    -> reasoning LOW (bounded trace, fast)
//   deep_reasoning (architecture)    -> reasoning HIGH (full thinking)
//
// Rationale: reasoning for a trivial request adds 10x+ TTFB on the hosted
// Nemotron endpoint. Reasoning is reserved for tasks that demonstrably benefit
// from a trace, and the trace is ALWAYS separated from visible content at the
// transport layer (never streamed to the UI).

const AI_TASK_CONFIG = {
    // Inline autocomplete: latency-sensitive but still premium via Flash. Keep small window for speed.
    // Premium: temp 1/top_p 0.95 not used here (needs determinism), but model is still DeepSeek Flash.
    autocomplete: {
        temperature: 0.1,
        top_p: 0.95,
        maxTokens: 512,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },

    // "/// comment" generation / one-line instruction rewrites.
    comment: {
        temperature: 0.3,
        top_p: 0.95,
        maxTokens: 2048,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },

    // Simple code transformations. Premium Flash handles these efficiently without reasoning.
    // For Minimax M3 (primary), allow larger context for full potential.
    simple_edit: {
        temperature: 0.1,
        top_p: 0.95,
        maxTokens: 8192,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },

    // Normal conversational chat — fast via Minimax/Groq, no high reasoning for speed
    // Minimax M3 handles chat efficiently with large context
    chat: {
        temperature: 0.7,
        top_p: 0.95,
        maxTokens: 2048,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },

    // Code explanation — fast, natural, now with more tokens for Minimax's detailed explanations
    explanation: {
        temperature: 0.5,
        top_p: 0.95,
        maxTokens: 2048,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },

    // Complex debugging / refactoring — fast Low, now with more tokens for Minimax
    complex_code: {
        temperature: 0.2,
        top_p: 0.95,
        maxTokens: 4096,
        reasoningMode: 'low',
        chatTemplateKwargs: { enable_thinking: true, reasoning_effort: 'low' },
    },

    // Fast chat for greetings — still premium but small
    fast_chat: {
        temperature: 1,
        top_p: 0.95,
        maxTokens: 512,
        reasoningMode: 'off',
        chatTemplateKwargs: { enable_thinking: false, reasoning_effort: 'none' },
    },

    // Deep reasoning — high but capped for speed, now with Minimax's full 16k potential
    // Minimax M3 excels at deep reasoning with large context
    deep_reasoning: {
        temperature: 0.7,
        top_p: 0.95,
        maxTokens: 8192,
        reasoningMode: 'high',
        chatTemplateKwargs: { enable_thinking: true, reasoning_effort: 'high' },
    },
};

function getTaskConfig(task) {
    return AI_TASK_CONFIG[task] || AI_TASK_CONFIG.chat;
}

module.exports = { AI_TASK_CONFIG, getTaskConfig };