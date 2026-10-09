# Fizzdoc MCP server

**Fizzdoc's PDF, audio and Office tools for AI agents — your files never leave your computer.**

Ask Claude Code, Codex, Claude Desktop, Cursor or any other [MCP](https://modelcontextprotocol.io) client to *"merge these PDFs"*, *"cut the first 30 seconds of this MP3"* or *"remove the author name before I send this"*. The agent calls Fizzdoc on your machine instead of uploading your file to a website or writing a throwaway script.

- **Local only.** Files are read from disk and new files are written next to them. No network, no telemetry, no account.
- **Never overwrites.** An existing name gets a new file like `report (2).pdf`.
- **Same engines as [fizzdoc.com](https://fizzdoc.com).** qpdf keeps forms, links and bookmarks; audio is cut and joined without re-encoding.

⭐ **If Fizzdoc helps you, please [star it on GitHub](https://github.com/kingrishabdugar/fizzdoc)** — it's free, and stars help other people find it.

## Tools

| Tool | What it does |
|---|---|
| `merge_pdf` | Combine PDFs in the order given |
| `split_pdf` | One file per page range, or every N pages |
| `extract_pdf_pages` | Save chosen pages as a new PDF, in the order typed |
| `reorder_pdf_pages` | Rearrange pages, e.g. `3, 1-2, 4-` |
| `delete_pdf_pages` | Remove pages |
| `rotate_pdf` | Rotate all or some pages by 90°, 180° or 270° |
| `protect_pdf` / `unlock_pdf` | Add or remove a password (AES-256) |
| `remove_pdf_metadata` | Strip author, title, creator app and XMP data |
| `pdf_info` | Page count and size |
| `trim_audio` | Keep one part of an MP3 or M4A |
| `split_audio` | Cut an MP3 or M4A into parts at given times |
| `merge_audio` | Join MP3 files, or M4A files, into one |
| `audio_info` | Format, duration, sample rate, channels |
| `clean_office` | Strip author, editor, company and title from a .docx, .xlsx or .pptx |

Page ranges look like `1-3, 8` (a trailing `-` means "to the end"). Times look like `1:30`, `90` or `1:02:03.5`.

## Set up

You need [Node.js](https://nodejs.org) 20 or newer.

### Claude Code

```sh
claude mcp add fizzdoc -- npx -y fizzdoc-mcp
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.fizzdoc]
command = "npx"
args = ["-y", "fizzdoc-mcp"]
```

### Claude Desktop, Cursor, VS Code and others

Add this to the client's MCP settings (`claude_desktop_config.json`, `.cursor/mcp.json`, …):

```json
{
  "mcpServers": {
    "fizzdoc": { "command": "npx", "args": ["-y", "fizzdoc-mcp"] }
  }
}
```

### From source

```sh
git clone https://github.com/kingrishabdugar/fizzdoc.git
cd fizzdoc
npm install
npm run build:mcp
```

Then use `node /path/to/fizzdoc/mcp/dist/server.js` as the command in any of the setups above.

## Develop

The tools live in [`src/tools.ts`](src/tools.ts) and call the same engines as the website (`../src/engine`). [`src/server.ts`](src/server.ts) describes them for agents. Tests in [`../tests/mcp.test.ts`](../tests/mcp.test.ts) run every tool over the real protocol and check the files it writes:

```sh
npx vitest run tests/mcp.test.ts
```

More tools (compress, convert, OCR, redact) are coming: see [#61](https://github.com/kingrishabdugar/fizzdoc/issues/61) and the other issues under [#57](https://github.com/kingrishabdugar/fizzdoc/issues/57). Contributions welcome.

## License

[Apache-2.0](https://github.com/kingrishabdugar/fizzdoc/blob/main/LICENSE) © [Rishab Dugar](https://rishabdugarjain.in)
