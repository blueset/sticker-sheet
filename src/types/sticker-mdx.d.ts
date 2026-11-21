declare module "virtual:sticker-mdx" {
  import type { ComponentType } from "react";
  import type { Lang } from "@/lib/localize";

  type Loader = () => Promise<{
    default: ComponentType<Record<string, never>>;
    __liveExprs?: string[];
  }>;

  export const description: Record<string, Partial<Record<Lang, Loader>>>;
  export const content: Record<string, Partial<Record<Lang, Loader>>>;
}
