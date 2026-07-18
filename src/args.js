const DEFAULT_URL = "https://app.luminiteapp.com";

export function parseArgs(argv) {
  const out = { command: "connect", name: null, as: null, mcpUrl: null, rotate: false, help: false, url: DEFAULT_URL };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rotate") out.rotate = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--url") out.url = argv[++i] ?? out.url;
    else if (arg === "--as") out.as = argv[++i] ?? out.as;
    else if (arg === "--mcp-url") out.mcpUrl = argv[++i] ?? out.mcpUrl;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  // strip a trailing slash so `${url}/cli/connect` never doubles up
  out.url = out.url.replace(/\/+$/, "");

  // Subcommands: `list`, `use <name>`, or bare `<name>` as sugar for `use <name>`.
  const [verb, name] = positional;
  if (verb === "list") out.command = "list";
  else if (verb === "use") { out.command = "use"; out.name = name ?? null; }
  else if (verb) { out.command = "use"; out.name = verb; }
  // no positional → stays "connect"
  return out;
}
