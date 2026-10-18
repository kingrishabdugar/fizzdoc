// The privacy page: what happens on the device, what reaches the host, and how to check it. English only.
// Keep it true to the code: update it whenever a tool starts storing or sending something new.

export const PRIVACY = {
  slug: 'privacy',
  title: 'Privacy — Your Files Never Leave Your Device | Fizzdoc',
  description:
    'How Fizzdoc handles your data: files are processed in your browser and never uploaded. No accounts, no cookies, no analytics and no trackers.',
  h1: 'Privacy',
  lede: 'Fizzdoc is built so that it never receives your files. Here is exactly what happens on your device, what reaches the company that hosts the website, and how you can check it yourself. Last updated 18 October 2026.',
  faq: [
    [
      'Are my files uploaded?',
      'No. Every tool runs inside your browser tab, using engines compiled to WebAssembly and AI models that run on your device. Your file is read from your device, processed there and saved back to it. The page’s security policy (connect-src \'self\') only lets it talk to fizzdoc.com, which serves nothing but the website itself.',
    ],
    [
      'What does Fizzdoc collect about me?',
      'Nothing. There are no accounts, no cookies, no analytics, no ads and no third-party scripts or fonts. Fizzdoc has no database and no server code of its own: the website is static files.',
    ],
    [
      'What is kept on my device?',
      'A few small settings in your browser’s storage: your light or dark theme, whether you closed the language tip, which tools are ready to use offline, and, if the big background model ever crashed a tab, a note to use the small one for 30 days. So that tools work offline, the browser also keeps a copy of the website and, after their first use, the background, speech and text-recognition files. None of this is sent anywhere, and you can delete it at any time in your browser’s settings for fizzdoc.com.',
    ],
    [
      'What does the company that hosts the website see?',
      'Fizzdoc is hosted on Cloudflare Pages. Like any web host, Cloudflare receives the usual details of each page request, such as your IP address and browser, in order to deliver the page, and handles them under Cloudflare’s own privacy policy. Your files are never part of those requests.',
    ],
    [
      'What about the links to GitHub?',
      'The star button, the “Report it” links and the source code links open GitHub, which has its own privacy policy. The star count shown on the site is added when the site is built, so your browser doesn’t contact GitHub to show it.',
    ],
    [
      'And the MCP server for AI agents?',
      'fizzdoc-mcp runs on your own computer: it reads files from your disk and writes the results next to them, without using the network.',
    ],
    [
      'How can I check all this myself?',
      'Open your browser’s developer tools, go to the Network tab and run any tool: you will see the website’s own files and nothing carrying your document. After a tool’s first run you can also turn off Wi-Fi and mobile data, and it keeps working. The source code is on GitHub under the Apache-2.0 license, and its test suite fails if any request leaves the site.',
    ],
    [
      'Who do I contact about privacy?',
      'Rishab Dugar, who builds Fizzdoc. Open an issue at github.com/kingrishabdugar/fizzdoc/issues with any question or concern.',
    ],
  ] as [string, string][],
};
