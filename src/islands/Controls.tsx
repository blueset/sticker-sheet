import { Globe, Locate, Minus, Moon, Plus, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { setLanguage } from "@/lib/appState";
import { useLanguage } from "@/lib/lang-hook";
import { isLang } from "@/lib/localize";
import { useTheme } from "@/lib/theme-hook";
import { t } from "@/lib/ui-strings";

// Same wrapper, classes, `data-action` attributes and labels as the markup
// this replaces. The zoom/centre buttons carry no handlers: `viewer/main.ts`
// handles `[data-action]` clicks for the whole document.
export default function Controls() {
  const lang = useLanguage();
  const { setTheme } = useTheme();

  return (
    <TooltipProvider>
      <div id="controls" className="absolute bottom-4 right-4 z-10 flex gap-2">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t(lang, "theme.toggleTheme")}>
                  <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "theme.toggleTheme")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}>{t(lang, "theme.light")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>{t(lang, "theme.dark")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>{t(lang, "theme.system")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t(lang, "changeLanguage")}>
                  <Globe />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "changeLanguage")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={lang}
              onValueChange={(value) => {
                if (isLang(value)) setLanguage(value);
              }}
            >
              <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="zh-Hans">简体中文</DropdownMenuRadioItem>
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
                data-action="zoom-in"
                aria-label={t(lang, "zoomIn")}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "zoomIn")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="rounded-r-full"
                data-action="zoom-out"
                aria-label={t(lang, "zoomOut")}
              >
                <Minus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t(lang, "zoomOut")}</TooltipContent>
          </Tooltip>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" data-action="center" aria-label={t(lang, "centerView")}>
              <Locate />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(lang, "centerView")}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
