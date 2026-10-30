export type Fallback =
  | "ask_for_product_urls_or_upload"
  | "ask_for_valid_url"
  | "retry"
  | "confirm_brand_kit_first"
  | "shorten_copy"
  | "product_hero_template"
  | "none";

export type ToolOk<T> = { ok: true } & T;
export type ToolFail = { ok: false; error: string; fallback: Fallback; [k: string]: unknown };
export type ToolResult<T> = ToolOk<T> | ToolFail;

export type Progress = (message: string, data?: Record<string, unknown>) => void;

export type ToolContext = {
  campaignId: string;
  /** Streams a `data-progress` part to the chat (no-op outside a request). */
  progress: Progress;
};

export const noProgress: Progress = () => {};
