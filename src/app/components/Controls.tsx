import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, Minus, Locate, Globe, Moon, Sun } from "lucide-react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useShallow } from "zustand/react/shallow";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

export function Controls({
  zoomIn,
  zoomOut,
  centerView,
}: {
  zoomIn: () => void;
  zoomOut: () => void;
  centerView: () => void;
}) {
  const { language, setLanguage } = useCanvasStore(
    useShallow((s) => ({
      language: s.language,
      setLanguage: s.setLanguage,
    }))
  );

  const { setTheme } = useTheme();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const savedLanguage = localStorage.getItem("language");
    if (savedLanguage) {
      setLanguage(savedLanguage);
    }
  }, []);

  useEffect(() => {
    i18n.changeLanguage(language);
    document.documentElement.lang = language;
    localStorage.setItem("language", language);
  }, [language]);

  return (
    <div className="absolute bottom-4 right-4 z-10 flex gap-2">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("theme.toggleTheme")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            {t("theme.light")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            {t("theme.dark")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            {t("theme.system")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline">
                <Globe />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("changeLanguage")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={language} onValueChange={setLanguage}>
            <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="zh-Hans">
              简体中文
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ja">日本語</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="rounded-l-full"
              onClick={() => zoomIn()}
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("zoomIn")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="rounded-r-full"
              onClick={() => zoomOut()}
            >
              <Minus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("zoomOut")}</TooltipContent>
        </Tooltip>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" onClick={() => centerView()}>
            <Locate />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("centerView")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
