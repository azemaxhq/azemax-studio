/**
 * Tests for the model router (server + client mirrors): NVIDIA-primary routing,
 * configured-only fallbacks, allowFallback:false, provider inference, task-aware
 * reasoning modes, and provider-specific request controls (unsupported params
 * must never be constructed for a provider that lacks the capability).
 *
 * Run with: npx tsx tests/aiModelRouter.test.ts
 */
import { check, finish } from './_harness';

// Deterministic routing tests: provider availability must not depend on the
// developer's local .env. A dummy Groq key marks the provider "configured"
// (routing logic only — the value is never used for network). Each test file
// runs isolated, so this does not leak into other suites.
if (!process.env.GROQ_API_KEY) process.env.GROQ_API_KEY = 'unit-test-routing-stub';

// ============================================================================
// Server router (CJS)
// ============================================================================
const serverRouter = await import('../server/services/ai/modelRouter.cjs');
const serverTaskConfig = await import('../server/services/ai/taskConfig.cjs');

const { resolveModel, buildRoutingPlan, inferProvider, stripPrefixes, listConfiguredModels, configuredFallbackModels } = serverRouter;

{
    // Fast primary (Nemotron/Groq) for instant /// — reasoning OFF for chat to be much faster
    const m = resolveModel('chat', undefined);
    check('server: chat primary is nvidia', m.provider === 'nvidia' && (m.model.includes('deepseek') || m.model.startsWith('nvidia/') || m.model.startsWith('deepseek') || m.model.includes('nemotron')));
    check('server: chat reasoning OFF (fast)', m.reasoningMode === 'off');
    check('server: chat force_nonempty off by default', m.forceNonemptyContent === false);
    // Thinking knob is model-family aware: Nemotron uses `enable_thinking`,
    // DeepSeek uses `thinking`. Assert the invariant (reasoning disabled),
    // not the key name, so the suite is independent of local .env models.
    const thinkingOff = (k: { enable_thinking?: boolean; thinking?: boolean } | null | undefined) =>
        k?.enable_thinking === false || k?.thinking === false;
    const thinkingOn = (k: { enable_thinking?: boolean; thinking?: boolean } | null | undefined) =>
        k?.enable_thinking === true || k?.thinking === true;
    check('server: chat kwargs disable thinking (fast)', m.chatTemplateKwargs && thinkingOff(m.chatTemplateKwargs) && m.chatTemplateKwargs.reasoning_effort === 'none');

    const complex = resolveModel('complex_code', undefined);
    check('server: complex_code reasoning LOW (fast)', complex.reasoningMode === 'low');
    check('server: complex_code enables thinking + effort=low (fast)', thinkingOn(complex.chatTemplateKwargs) && complex.chatTemplateKwargs?.reasoning_effort === 'low');

    const deep = resolveModel('deep_reasoning', undefined);
    check('server: deep_reasoning reasoning HIGH', deep.reasoningMode === 'high');
    check('server: deep_reasoning full thinking (reasoning_effort=high)', deep.chatTemplateKwargs?.reasoning_effort === 'high' && (deep.chatTemplateKwargs?.enable_thinking === true || deep.chatTemplateKwargs?.enable_thinking === undefined));

    // Autocomplete/comment/simple_edit/fast_chat/explanation stay OFF for speed
    for (const task of ['autocomplete', 'comment', 'simple_edit', 'fast_chat', 'explanation']) {
        check(`server: ${task} reasoning OFF`, resolveModel(task, undefined).reasoningMode === 'off');
    }
}

{
    // Provider-specific controls: non-NVIDIA providers get NO chat_template_kwargs
    // (unsupported params are omitted, never sent).
    const groqModel = resolveModel('chat', 'qwen/qwen3.8-27b');
    check('server: groq has no chat_template_kwargs', groqModel.provider === 'groq' && groqModel.chatTemplateKwargs === null);
    check('server: groq model id stripped', groqModel.model === 'qwen/qwen3.8-27b');

    const orModel = resolveModel('chat', 'or:nvidia/nemotron-3-super-120b-a12b:free');
    check('server: or: prefix stripped', orModel.provider === 'openrouter' && orModel.model === 'nvidia/nemotron-3-super-120b-a12b:free');

    const hfModel = resolveModel('chat', 'hf:deepseek-ai/DeepSeek-R1:novita');
    check('server: hf: prefix stripped + no streaming capability', hfModel.provider === 'huggingface' && hfModel.model === 'deepseek-ai/DeepSeek-R1:novita' && hfModel.capabilities.supportsStreaming === false);
}

{
    // inferProvider / stripPrefixes
    check('infer: nvidia default', inferProvider('nvidia/nemotron-3-super-120b-a12b') === 'nvidia');
    check('infer: groq by id', inferProvider('qwen/qwen3.8-27b') === 'groq');
    check('infer: or: prefix', inferProvider('or:nvidia/nemotron-3-super-120b-a12b:free') === 'openrouter');
    check('infer: hf: prefix', inferProvider('hf:deepseek-ai/DeepSeek-R1:novita') === 'huggingface');
    check('infer: bare no-slash defaults groq', inferProvider('allam-2-7b') === 'groq');
    check('strip: OR prefix', stripPrefixes('or:nvidia/nemotron-3-super-120b-a12b:free') === 'nvidia/nemotron-3-super-120b-a12b:free');
    check('strip: HF prefix', stripPrefixes('hf:x') === 'x');
    check('strip: no prefix passthrough', stripPrefixes('qwen/qwen3.8-27b') === 'qwen/qwen3.8-27b');
}

{
    // Routing plan: primary is always NVIDIA; fallbacks come ONLY from configured
    // providers, never duplicate the primary, and never include NVIDIA again.
    const plan = buildRoutingPlan('chat', undefined, { allowFallback: true });
    check('plan: primary is nvidia', plan.primary.provider === 'nvidia');
    check('plan: fallbacks never duplicate primary', plan.fallbacks.every((f) => f.model !== plan.primary.model));
    check('plan: fallbacks only configured providers', plan.fallbacks.every((f) => ['groq', 'openrouter', 'huggingface', 'kilocode'].includes(f.provider)));
    check('plan: fallback indices increment from 1', plan.fallbacks.every((f, i) => f.fallbackIndex === i + 1));

    const noFallback = buildRoutingPlan('chat', undefined, { allowFallback: false });
    check('plan: allowFallback:false yields no fallbacks', noFallback.fallbacks.length === 0);

    // Latency: fast_chat (greetings) defaults to the fast Groq primary when
    // configured; an explicit model always wins.
    const fast = buildRoutingPlan('fast_chat', undefined, { allowFallback: true });
    check('plan: fast_chat primary is groq (fast)', fast.primary.provider === 'groq');
    const fastExplicit = buildRoutingPlan('fast_chat', 'deepseek-ai/deepseek-v4-flash-0731', { allowFallback: true });
    check('plan: fast_chat explicit model wins', fastExplicit.primary.provider === 'nvidia');
}

{
    // Reasoning modes are driven by taskConfig profiles (server truth) - fast for much faster response
    check('taskConfig: chat enable_thinking false (fast)', serverTaskConfig.getTaskConfig('chat').chatTemplateKwargs?.enable_thinking === false && serverTaskConfig.getTaskConfig('chat').chatTemplateKwargs?.reasoning_effort === 'none');
    check('taskConfig: complex_code reasoningMode low (fast)', serverTaskConfig.getTaskConfig('complex_code').reasoningMode === 'low');
    check('taskConfig: unknown task falls back to chat (off fast)', serverTaskConfig.getTaskConfig('bogus').reasoningMode === 'off');
    check('taskConfig: configuredFallbackModels respects keys', Array.isArray(configuredFallbackModels()));

    const models = listConfiguredModels();
    check('list: includes nvidia primary', models.some((m) => m.primary === true && m.provider === 'nvidia'));
    check('list: every entry has provider+id', models.every((m) => m.id && m.provider));
}

// ============================================================================
// Client router mirror
// ============================================================================
const {
    resolveModel: clientResolveModel,
    buildDirectChain,
    inferProvider: clientInfer,
    stripPrefixes: clientStrip,
    configuredDirectProviders,
    defaultModelFor,
} = await import('../src/core/ai/modelRouter');
const { getTaskConfig } = await import('../src/core/ai/taskConfigClient');

{
    // Client router mirrors server fast profiles (no high reasoning for speed)
    const m = clientResolveModel('chat', 'deepseek-ai/deepseek-v4-flash-0731');
    check('client: chat reasoning OFF (fast)', m.reasoningMode === 'off');
    check('client: complex_code reasoning LOW (fast)', clientResolveModel('complex_code', 'deepseek-ai/deepseek-v4-flash-0731').reasoningMode === 'low');
    check('client: deep_reasoning HIGH', clientResolveModel('deep_reasoning', 'deepseek-ai/deepseek-v4-flash-0731').reasoningMode === 'high');

    // NVIDIA is NEVER a direct-callable model (its key lives server-side) - even for DeepSeek.
    const chain = buildDirectChain('chat', 'deepseek-ai/deepseek-v4-flash-0731', { allowFallback: true });
    check('client: direct chain never contains nvidia', chain.every((m) => clientInfer(m) !== 'nvidia'));
    // Without configured VITE keys there are no direct providers; with keys the
    // chain must start with a configured one.
    const directProviders = configuredDirectProviders();
    check('client: direct chain empty when no keys, else starts configured', chain.length === 0 || (chain.length > 0 && directProviders.includes(clientInfer(chain[0]))));

    const single = buildDirectChain('autocomplete', undefined, { allowFallback: false });
    check('client: allowFallback:false yields one model', single.length === 1 || single.length === 0);

    check('client: infer OR prefix', clientInfer('or:nvidia/nemotron-3-super-120b-a12b:free') === 'openrouter');
    check('client: infer HF prefix', clientInfer('hf:x') === 'huggingface');
    check('client: strip OR prefix', clientStrip('or:nvidia/nemotron-3-super-120b-a12b:free') === 'nvidia/nemotron-3-super-120b-a12b:free');
    check('client: defaultModelFor groq', defaultModelFor('groq') === 'qwen/qwen3.8-27b');
}

const { getSmartModel, FAST_EDITOR_MODEL } = await import('../src/core/ai/AIContextBuilder');

{
    // Latency: ghost completions must use the fast model (~0.3s), never the
    // slow premium primary (~13s TTFB) — a 13s ghost suggestion is useless.
    check('smartModel: inline-suggest uses fast editor model', getSmartModel('inline-suggest') === FAST_EDITOR_MODEL);
    check('smartModel: fast model is groq qwen', FAST_EDITOR_MODEL === 'qwen/qwen3.8-27b');
    check('smartModel: code-gen keeps premium default', getSmartModel('code-gen') !== FAST_EDITOR_MODEL);
}

{
    check('clientTaskConfig: chat reasoning off (fast)', getTaskConfig('chat').reasoningMode === 'off');
    check('clientTaskConfig: fast_chat off', getTaskConfig('fast_chat').reasoningMode === 'off');
    check('clientTaskConfig: complex_code low (fast)', getTaskConfig('complex_code').reasoningMode === 'low');
    check('clientTaskConfig: deep_reasoning high', getTaskConfig('deep_reasoning').reasoningMode === 'high');
    check('clientTaskConfig: unknown falls back to chat (off)', getTaskConfig(undefined).reasoningMode === 'off');
}

const serverPolicy = await import('../server/services/ai/aiPolicy.cjs');

{
    // REGRESSION: "Explanation failed — Model not permitted on provider
    // nvidia". The client sends the canonical ID
    // 'nvidia/nemotron-3-super-120b-a12b' (with -a12b suffix) while the
    // server default has no suffix. Both spellings of the same model must
    // pass policy, or every explicit-model request 403s before any
    // provider fallback can run.
    const allowed = serverPolicy.nvidiaAllowed();
    check('policy: allows suffixed client canonical id', allowed.has('nvidia/nemotron-3-super-120b-a12b'));
    check('policy: allows unsuffixed server default id', allowed.has('nvidia/nemotron-3-super-120b-a12b'));
    check(
        'policy: resolveAllowedModel accepts client canonical id',
        serverPolicy.resolveAllowedModel('nvidia', 'nvidia/nemotron-3-super-120b-a12b') === 'nvidia/nemotron-3-super-120b-a12b',
    );
    let rejected = false;
    try {
        serverPolicy.resolveAllowedModel('nvidia', 'nvidia/llama-3.1-405b-instruct');
    } catch (e) {
        rejected = e instanceof Error && (e as unknown as { status?: number }).status === 403;
    }
    check('policy: still rejects unlisted nvidia models with 403', rejected);
}

finish('aiModelRouter');