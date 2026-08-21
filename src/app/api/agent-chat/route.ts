import { NextRequest, NextResponse } from 'next/server';

interface AgentChatRequest {
  agentId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface AgentChatResponse {
  reply: string;
  agentId: string;
}

const AGENT_PROMPTS: Record<string, string> = {
  coordinator: "You are describing the Coordinator role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role coordinates incidents (Development/PoC or Production, whichever the operator asks about), assigns incident IDs, delegates diagnosis to the Apps/Edge/Infra specialists, and requires independent verification before closing an incident. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  apps: "You are describing the Apps role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role diagnoses applications, APIs, deployments, and databases — establishing the deployed commit/image/config before treating source code as evidence, and recommending the smallest reversible fix. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  edge: "You are describing the Edge role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role diagnoses Coolify, Cloudflare, DNS, tunnels, and reverse-proxy routing issues. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  infra: "You are describing the Infra role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role diagnoses nodes, Docker, Sentinel, resources, networking, and runtime health. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
  verifier: "You are describing the Verifier role on the V-Decent Support team, to the operator. You are not the real agent and have no access to real incident data or system state. In your own words, explain that this role independently verifies evidence, mitigations, recovery, and report completeness before an incident closes — never taking the coordinator's or a specialist's word for it. If asked to diagnose, check status, or take any action, decline and point at the kanban board on this page for real status instead of guessing.",
};

export async function POST(request: NextRequest): Promise<NextResponse<AgentChatResponse | { error: string }>> {
  try {
    const body: AgentChatRequest = await request.json();
    const { agentId, message, history = [] } = body;

    // Validate inputs
    if (!agentId || !message) {
      return NextResponse.json(
        { error: 'Missing agentId or message' },
        { status: 400 }
      );
    }

    if (!AGENT_PROMPTS[agentId]) {
      return NextResponse.json(
        { error: `Unknown agent: ${agentId}` },
        { status: 400 }
      );
    }

    const systemPrompt = AGENT_PROMPTS[agentId];
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.error('OPENROUTER_API_KEY not configured');
      return NextResponse.json(
        { error: 'API configuration error' },
        { status: 500 }
      );
    }

    // Build messages array: system prompt + history + current message
    const messages = [
      ...history,
      { role: 'user' as const, content: message },
    ];

    // Call OpenRouter API
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://your-app.vercel.app',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenRouter API error:', error);
      return NextResponse.json(
        { error: 'Failed to get response from AI model' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';

    if (!reply) {
      return NextResponse.json(
        { error: 'No response from AI model' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      reply,
      agentId,
    });
  } catch (error) {
    console.error('Agent chat error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
