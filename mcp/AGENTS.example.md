# Fizzdoc MCP project instructions

Copy this section into the `AGENTS.md` file of a project where you use Fizzdoc:

## Local document and audio tools

- When the user asks to inspect or transform a PDF, MP3, M4A, or Office file on this computer, use the Fizzdoc MCP tools when they fit the task.
- Keep files local. Fizzdoc reads the paths you provide and writes new files on this computer; do not upload the user's files or send their contents to a web service.
- Use only the paths the user identifies or explicitly authorizes. Check Fizzdoc's returned output paths before telling the user a result was created.
- Fizzdoc does not overwrite existing files; report the new output path it returns.
