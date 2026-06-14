const DEFAULT_URL = "https://app.luminiteapp.com";

export function parseArgs(argv) {
  const out = { rotate: false, help: false, url: DEFAULT_URL };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rotate") out.rotate = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--url") out.url = argv[++i] ?? out.url;
  }
  // strip a trailing slash so `${url}/cli/connect` never doubles up
  out.url = out.url.replace(/\/+$/, "");
  return out;
}
