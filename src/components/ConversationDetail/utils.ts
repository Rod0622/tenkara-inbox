// Pure helpers extracted from ConversationDetail — no side effects.

export function normalizeSuggestedTaskText(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


export function getNormalizedTokens(value: string) {
  return normalizeSuggestedTaskText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

export function getTaskMatchMeta(itemText: string, tasks: any[]) {
  const normalizedItem = normalizeSuggestedTaskText(itemText);
  const itemTokens = getNormalizedTokens(itemText);

  let bestTask: any = null;
  let bestScore = 0;

  for (const task of tasks || []) {
    const taskText = String(task?.text || "");
    const normalizedTask = normalizeSuggestedTaskText(taskText);

    if (!normalizedTask) continue;

    if (normalizedTask === normalizedItem) {
      return {
        matchedTask: task,
        score: 1,
        isCompleted: task?.status === "completed" || task?.is_done,
      };
    }

    const taskTokens = getNormalizedTokens(taskText);
    if (itemTokens.length === 0 || taskTokens.length === 0) continue;

    const taskTokenSet = new Set(taskTokens);
    const sharedCount = itemTokens.filter((token) => taskTokenSet.has(token)).length;
    const score = sharedCount / Math.max(itemTokens.length, taskTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestTask = task;
    }
  }

  if (bestTask && bestScore >= 0.5) {
    return {
      matchedTask: bestTask,
      score: bestScore,
      isCompleted: bestTask?.status === "completed" || bestTask?.is_done,
    };
  }

  return {
    matchedTask: null,
    score: 0,
    isCompleted: false,
  };
}

// Highlight search matches in text
