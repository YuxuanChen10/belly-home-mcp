export function toolFailure(error, fallback = "Tool call failed") {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : fallback }]
  };
}

export function toolResult(value) {
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}
