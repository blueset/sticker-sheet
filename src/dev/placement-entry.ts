// Dev-only client entry: ./integration.ts injects it into every page under
// `astro dev`. The editor does nothing on pages without stickers.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import PlacementEditor from "./PlacementEditor";

const host = document.createElement("div");
host.hidden = true;
document.body.append(host);
createRoot(host).render(createElement(PlacementEditor));
