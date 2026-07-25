---
description: Ask a question about this project and answer from Luminite's indexed memory
---

Call the `recall` tool from the `luminite` MCP server with this question:

$ARGUMENTS

Then answer the question using only what came back, plus anything you can verify
in the codebase. Rules:

- Cite the specific decision, task, or gotcha you used. Refer to items by their
  title or text, never by their numeric id.
- Each result carries a cosine distance — lower is closer. Disregard weak matches
  rather than working them into the answer.
- If nothing relevant came back, say so plainly. Do not guess, and do not pad the
  answer with general knowledge presented as project fact.
- If the answer depends on something only the code can tell you, read the code.
