import { and, count, eq, gte, sql } from 'drizzle-orm';
import { db, schema as s } from './db.js';

export type AiFeature = 'home' | 'recap' | 'onboarding' | 'eventEmail';

type Prompt = { system: string; user: string };
type PromptSource = Prompt | (() => Prompt | Promise<Prompt>);
type JsonSchema = Record<string, unknown>;

type BaseOptions = {
  feature: AiFeature;
  userId: number;
  householdId: number;
  prompt: PromptSource;
  maxTokens?: number;
};

export type AiCallResult<T> = {
  status: 'ok' | 'disabled' | 'limited' | 'failed';
  value: T | null;
};

const featureConfig: Record<AiFeature, { flag: string; model: string; hourlyLimit: number; maxTokens: number }> = {
  home: { flag: 'HOME_AI_ENABLED', model: 'HOME_AI_MODEL', hourlyLimit: 6, maxTokens: 120 },
  recap: { flag: 'RECAP_AI_ENABLED', model: 'RECAP_AI_MODEL', hourlyLimit: 6, maxTokens: 120 },
  onboarding: { flag: 'ONBOARDING_AI_ENABLED', model: 'ONBOARDING_AI_MODEL', hourlyLimit: 3, maxTokens: 1_400 },
  eventEmail: { flag: 'EVENT_EMAIL_AI_ENABLED', model: 'EVENT_EMAIL_AI_MODEL', hourlyLimit: 6, maxTokens: 240 },
};

const openRouterModel = (feature: AiFeature) => process.env[featureConfig[feature].model] || process.env.OPENROUTER_MODEL || process.env.AI_MODEL;
export const aiEnabled = (feature: AiFeature) => process.env[featureConfig[feature].flag] === '1'
  && (!!process.env.ANTHROPIC_API_KEY || (!!process.env.OPENROUTER_API_KEY && !!openRouterModel(feature)));

async function reserveCall(feature: AiFeature, userId: number, householdId: number): Promise<boolean> {
  const config = featureConfig[feature];
  return db.transaction(async (tx) => {
    // Serialize checks for this exact user/household/feature so parallel serverless calls cannot exceed the limit.
    const lockKey = `roomie-ai:${userId}:${householdId}:${feature}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const since = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
    const [row] = await tx.select({ total: count() }).from(s.aiUsage).where(and(
      eq(s.aiUsage.userId, userId),
      eq(s.aiUsage.householdId, householdId),
      eq(s.aiUsage.feature, feature),
      gte(s.aiUsage.createdAt, since),
    ));
    if ((row?.total ?? 0) >= config.hourlyLimit) return false;
    await tx.insert(s.aiUsage).values({ userId, householdId, feature });
    return true;
  });
}

const resolvePrompt = (source: PromptSource) => typeof source === 'function' ? source() : source;

type AnthropicContent =
  | { type: 'text'; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown };

type AnthropicResponse = {
  content?: AnthropicContent[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function callProvider(
  options: BaseOptions,
  extra: Record<string, unknown> = {},
): Promise<AiCallResult<AnthropicResponse>> {
  if (!aiEnabled(options.feature)) return { status: 'disabled', value: null };
  try {
    if (!await reserveCall(options.feature, options.userId, options.householdId)) return { status: 'limited', value: null };
    const prompt = await resolvePrompt(options.prompt);
    const config = featureConfig[options.feature];
    // Keep direct Anthropic backward-compatible when both are configured; OpenRouter is used when it is the available key.
    const useOpenRouter = !!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY;
    const model = useOpenRouter ? openRouterModel(options.feature)! : process.env[config.model] || process.env.AI_MODEL || 'claude-haiku-5-5';
    const maxTokens = Math.min(Math.max(1, options.maxTokens ?? config.maxTokens), config.maxTokens);
    const anthropicTool = (extra.tools as { name: string; description: string; input_schema: JsonSchema }[] | undefined)?.[0];
    const openRouterBody = {
      model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      ...(anthropicTool ? {
        tools: [{ type: 'function', function: { name: anthropicTool.name, description: anthropicTool.description, parameters: anthropicTool.input_schema } }],
        tool_choice: { type: 'function', function: { name: anthropicTool.name } },
      } : {}),
    };
    const response = await fetch(useOpenRouter
      ? `${process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`
      : `${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: useOpenRouter ? {
          'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY!}`,
          ...(process.env.APP_ORIGIN ? { 'HTTP-Referer': process.env.APP_ORIGIN } : {}), 'X-Title': 'Roomie',
        } : { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(useOpenRouter ? openRouterBody : { model, max_tokens: maxTokens, system: prompt.system, messages: [{ role: 'user', content: prompt.user }], ...extra }),
        signal: AbortSignal.timeout(15_000),
      });
    if (!response.ok) return { status: 'failed', value: null };
    let value: AnthropicResponse;
    if (useOpenRouter) {
      const raw = await response.json() as {
        choices?: { message?: { content?: string | null; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = raw.choices?.[0]?.message, tool = message?.tool_calls?.[0]?.function;
      let input: unknown;
      try { input = tool?.arguments ? JSON.parse(tool.arguments) : undefined; } catch { input = undefined; }
      value = {
        content: tool?.name ? [{ type: 'tool_use', name: tool.name, input }] : [{ type: 'text', text: message?.content ?? undefined }],
        usage: { input_tokens: raw.usage?.prompt_tokens, output_tokens: raw.usage?.completion_tokens },
      };
    } else value = await response.json() as AnthropicResponse;
    if (value.usage) console.info('AI usage', {
      feature: options.feature,
      model,
      inputTokens: value.usage.input_tokens ?? 0,
      outputTokens: value.usage.output_tokens ?? 0,
    });
    return { status: 'ok', value };
  } catch (error) {
    console.error(`${options.feature} AI call failed`, error instanceof Error ? error.message : error);
    return { status: 'failed', value: null };
  }
}

/** Generate plain text for a feature. Disabled, limited, and failed calls never throw. */
export async function callText(options: BaseOptions): Promise<AiCallResult<string>> {
  const result = await callProvider(options);
  if (result.status !== 'ok') return { status: result.status, value: null };
  const text = result.value?.content?.find((part) => part.type === 'text')?.text ?? null;
  return { status: 'ok', value: text };
}

/** Generate schema-shaped data with the provider's named tool forced for the entire request. */
export async function callTool<T>(options: BaseOptions & {
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
}): Promise<AiCallResult<T>> {
  const { toolName, toolDescription, schema, ...base } = options;
  const result = await callProvider(base, {
    tools: [{ name: toolName, description: toolDescription, input_schema: schema }],
    tool_choice: { type: 'tool', name: toolName },
  });
  if (result.status !== 'ok') return { status: result.status, value: null };
  const toolUse = result.value?.content?.find(
    (part): part is Extract<AnthropicContent, { type: 'tool_use' }> => part.type === 'tool_use' && part.name === toolName,
  );
  if (toolUse?.input === undefined) return { status: 'failed', value: null };
  return { status: 'ok', value: toolUse.input as T };
}
