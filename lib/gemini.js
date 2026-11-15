const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const model = "gemini-3.5-flash-lite";

export async function requestGemini({ input, instructions, schema, maxTokens, durationSeconds }, {
  apiKey, signal, fetcher = fetch, purpose, checkError,
}) {
  const start = performance.now();
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model,
      input,
      system_instruction: instructions,
      response_format: { type: "text", mime_type: "application/json", schema },
      generation_config: { thinking_level: "minimal", max_output_tokens: maxTokens },
      store: false,
    }),
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    if (checkError) await checkError(response);
    throw new Error(`Gemini returned HTTP ${response.status}`);
  }

  const interaction = await response.json();
  if (interaction.usage) {
    console.info("Markdone Gemini usage", {
      purpose,
      durationSeconds: durationSeconds ?? null,
      elapsedMs: Math.round(performance.now() - start),
      inputTokens: interaction.usage.total_input_tokens,
      outputTokens: interaction.usage.total_output_tokens,
      thoughtTokens: interaction.usage.total_thought_tokens,
    });
  }
  if (interaction.status !== "completed" || !Array.isArray(interaction.steps)) {
    throw new Error("Gemini did not complete the request");
  }
  const output = interaction.steps.findLast((step) => step.type === "model_output");
  const json = output?.content.filter((part) => part.type === "text").map((part) => part.text).join("");
  return JSON.parse(json);
}
