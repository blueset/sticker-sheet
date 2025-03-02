import { TooltipProvider } from "@/components/ui/tooltip";
import { Canvas } from "./components/Canvas";
import { Panel } from "./components/Panel";
// import fs from "fs";
// import yaml from "js-yaml";
// import path from "path";
// import { StickerType } from "./store/useCanvasStore";

// const STICKERS_DIR = "./src/data/stickers";
// Load all sticker data from individual files
// const stickers: StickerType[] = fs
//   .readdirSync(STICKERS_DIR)
//   .filter((file) => file.endsWith(".yaml"))
//   .map((file) => {
//     const slug = path.basename(file, ".yaml");
//     const data = yaml.load(
//       fs.readFileSync(path.join(STICKERS_DIR, file), "utf8")
//     ) as Omit<StickerType, "slug">;

//     return { slug, ...data };
//   });

import stickers from "@/data/stickers.yaml";
import { StickerType } from "./store/useCanvasStore";

export default function Home() {
  return (
    <TooltipProvider>
      <div className="h-dvh w-dvw overflow-hidden relative">
        <Canvas initialStickers={stickers as StickerType[]} />
        <Panel />
      </div>
    </TooltipProvider>
  );
}
