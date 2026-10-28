import type { Presentation } from "../core/content.ts";

export interface ContentExpressions {
  circle: string;
  line: string;
}

export type ContentPart = Record<string, ContentExpressions>;

export type ContentPartLoader = () => Promise<ContentPart>;

export type ContentPartLoaders = Record<string, ContentPartLoader>;

export type { Presentation };
