export type SuggestedTaskItem = {
  id: string;
  text: string;
  normalizedText: string;
  alreadyCreated: boolean;
};

export type OpenActionItemState = {
  id: string;
  text: string;
  taskMatch: any | null;
  score: number;
  state: "needs_task" | "tracked" | "completed";
};

export type CompletedItemState = {
  id: string;
  text: string;
  taskMatch: any | null;
  score: number;
  state: "confirmed_completed" | "still_open" | "ai_only";
};
