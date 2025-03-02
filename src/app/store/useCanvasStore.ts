import { create } from "zustand";

export type LocalizedContent = Record<string, string | undefined>;

export interface StickerType {
  slug: string;
  x: number;
  y: number;
  image?: string;
  content?: LocalizedContent;
  clipPath?: string;
  width: number;
  height: number;
  rotation?: number;
  title: LocalizedContent;
  description?: LocalizedContent;
}

interface CanvasState {
  stickers: StickerType[];
  canvasWidth: number;
  canvasHeight: number;
  selectedSticker: StickerType | null;
  hoveredSticker: StickerType | null;
  isPanelOpen: boolean;
  language: string;
  setStickers: (stickers: StickerType[]) => void;
  updateSticker: (idx: number, sticker: Partial<StickerType>) => void;
  selectSticker: (sticker: StickerType | null) => void;
  setPanelOpen: (isOpen: boolean) => void;
  setHoveredSticker: (sticker: StickerType | null) => void;
  setLanguage: (language: string) => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  stickers: [],
  canvasWidth: 10000,
  canvasHeight: 10000,
  selectedSticker: null,
  hoveredSticker: null,
  isPanelOpen: false,
  language: "en",
  setStickers: (stickers) => set({ stickers }),
  updateSticker: (idx, sticker) =>
    set((state) => ({
      stickers: state.stickers.map((s, i) =>
        i === idx ? { ...s, ...sticker } : s
      ),
    })),
  selectSticker: (sticker) => {
    set({ selectedSticker: sticker });
  },
  setPanelOpen: (isOpen) => set({ isPanelOpen: isOpen }),
  setHoveredSticker: (sticker) => set({ hoveredSticker: sticker }),
  setLanguage: (language) => set({ language }),
}));
