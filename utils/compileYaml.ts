#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net

import { parse, stringify } from "jsr:@eemeli/yaml";

const SRC_DIR = "./src/data/stickers";
const OUTPUT_FILE = "./src/data/stickers.yaml";

async function constructStickersYaml() {
    const stickers = [];
    for await (const dirEntry of Deno.readDir(SRC_DIR)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".yaml")) {
            const slug = dirEntry.name.split(".").slice(0, -1).join(".");
            const filepath = `${SRC_DIR}/${dirEntry.name}`;
            const fileContent = await Deno.readTextFile(filepath);
            const data = parse(fileContent);
            if (typeof data === "object" && data !== null) {
                data["slug"] = slug;
                stickers.push(data);
            }
        }
    }
    const yamlContent = stringify(stickers);
    await Deno.writeTextFile(OUTPUT_FILE, yamlContent);
}

async function handleFileSystemEvent(event: Deno.FsEvent) {
    for (const path of event.paths) {
        if (path.endsWith(".yaml")) {
            console.log(`Detected change in ${path}, updating stickers.yaml...`);
            await constructStickersYaml();
            break;
        }
    }
}

async function monitorStickersDirectory() {
    console.log(`Monitoring changes in ${SRC_DIR}...`);
    const watcher = Deno.watchFs(SRC_DIR);
    for await (const event of watcher) {
        if (["create", "modify", "remove"].includes(event.kind)) {
            await handleFileSystemEvent(event);
        }
    }
}

if (import.meta.main) {
    // Initial construction of the output file
    await constructStickersYaml();
    // Start monitoring the directory
    await monitorStickersDirectory();
}
