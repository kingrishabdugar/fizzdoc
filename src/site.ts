// Single source of truth for brand, tool pages and their search copy.
// Used by the Vite build (prerendered pages, sitemap, llms.txt) and by the app.
import type { Op } from './engine/pdf.ts';

/** qpdf jobs (engine/pdf.ts) plus the tools that run in engine/local.ts. */
export type ToolOp =
  | Op
  | 'jpg-to-pdf'
  | 'pdf-to-jpg'
  | 'office-clean'
  | 'office-images'
  | 'office-compress'
  | 'compress-pdf'
  | 'edit-pdf'
  | 'redact-pdf'
  | 'remove-bg'
  | 'scan-pdf'
  | 'ocr-pdf'
  | 'pdf-to-word'
  | 'pdf-to-powerpoint'
  | 'pdf-to-text'
  | 'text-to-pdf'
  | 'word-to-pdf'
  | 'excel-to-csv'
  | 'csv-to-excel'
  | 'excel-to-json'
  | 'json-to-excel'
  | 'mermaid-image'
  | 'image-convert'
  | 'image-ocr'
  | 'page-numbers'
  | 'watermark-pdf'
  | 'audio-split'
  | 'audio-merge'
  | 'transcribe';
export type Format = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'image' | 'audio';

export const SITE = {
  name: 'Fizzdoc',
  url: 'https://fizzdoc.com',
  repo: 'https://github.com/kingrishabdugar/fizzdoc',
  tagline: 'Private PDF, Word, Excel, PowerPoint and image tools that never upload your files',
};

export interface Tool {
  op: ToolOp;
  format: Format;
  slug: string;
  name: string;
  /** One line for tool cards. */
  summary: string;
  /** Verb on the action button. */
  action: string;
  title: string;
  description: string;
  h1: string;
  lede: string;
  steps: string[];
  faq: [question: string, answer: string][];
  /** File picker override; the default follows the format (one .pdf, .docx, …). */
  input?: { accept: string; multiple?: boolean };
  /** Fixed engine options for this page, e.g. { format: 'md' } for PDF to Markdown. */
  preset?: Record<string, string>;
  /** Phrases people search for that this tool answers; shown on the page and in structured data. */
  keywords?: string[];
}

const PRIVACY_FAQ: [string, string][] = [
  [
    'Are my files uploaded anywhere?',
    'No. Fizzdoc does the work inside your browser tab, using open-source engines compiled to WebAssembly and JavaScript. Your file is read from your device, processed locally, and the result is saved straight back to your device. You can check this yourself: open your browser’s developer tools, go to the Network tab, and run a job — no request carries your file.',
  ],
  [
    'Is Fizzdoc free?',
    'Yes, and it stays free: no sign-up, no watermark, no daily limit and no premium tier. Fizzdoc is open source under the Apache-2.0 license, so anyone can run their own copy.',
  ],
];

// Audio to Text and its siblings share how they work and what to expect.
const TRANSCRIBE_IN = { accept: 'audio/*,video/*,.mp3,.m4a,.wav,.ogg,.oga,.opus,.flac,.aac,.webm,.mp4,.m4v,.mov' };
const TRANSCRIBE_STEPS = [
  'Choose an audio or video file (MP3, M4A, WAV, OGG, MP4 or WebM).',
  'Pick the spoken language, or leave it on auto-detect, and choose text or subtitles.',
  'Start it. The first time, the speech model downloads once; then read the text and download it.',
];
const TRANSCRIBE_ACCURACY: [string, string] = [
  'How accurate is it?',
  'Fizzdoc uses Whisper tiny, a small version of OpenAI’s open speech model that runs fully in your browser. Clear English speech comes out well; noisy recordings, strong accents, other languages and mixed speech such as Hindi with English are much rougher, so read the text through before you rely on it.',
];
const TRANSCRIBE_FIRST_RUN: [string, string] = [
  'Why is the first run slower?',
  'The first time, your browser downloads the speech model (about 58 MB) and keeps it, so later runs start in seconds, even offline. Transcribing takes a while for long recordings: speed depends on your device, and a laptop is much faster than a phone.',
];

export const TOOLS: Tool[] = [
  {
    op: 'merge',
    format: 'pdf',
    slug: 'merge-pdf',
    name: 'Merge PDF',
    summary: 'Combine several PDFs into one, in the order you choose.',
    action: 'Merge PDFs',
    title: 'Merge PDF Free — Combine PDF Files Online, No Upload | Fizzdoc',
    description:
      'Combine PDF files in your browser. Nothing is uploaded, and form fields and links are kept. Free, no sign-up, open source.',
    h1: 'Merge PDF files without uploading them',
    lede: 'Combine PDFs into one document right in your browser. Nothing is sent to a server, and form fields and internal links survive the merge.',
    steps: [
      'Add two or more PDF files — drag them in or click to choose.',
      'Put them in order with the ↑ and ↓ buttons.',
      'Click “Merge PDFs” and download the combined file.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will bookmarks, form fields and links survive?',
        'Form fields and internal links from every file are kept. Bookmarks from the first file are kept; bookmarks from the other files cannot be combined yet, and Fizzdoc tells you when that happens instead of dropping them silently.',
      ],
      [
        'Can I merge password-protected PDFs?',
        'Yes. You are asked for the password on your device, and the merged file is saved without a password.',
      ],
      [
        'Is there a size limit?',
        'There is no page limit. The size limit depends on your device’s memory — usually several hundred megabytes in total — and Fizzdoc tells you before starting if a job is too large for your device.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'split',
    format: 'pdf',
    slug: 'split-pdf',
    name: 'Split PDF',
    summary: 'Extract the pages you need into a new PDF.',
    action: 'Extract pages',
    title: 'Split PDF Free — Separate PDF Pages Online, No Upload | Fizzdoc',
    description:
      'Extract pages from a PDF in your browser. Pick ranges like 1-3, 8 — your file never leaves your device. Free, no sign-up, open source.',
    h1: 'Split a PDF and extract pages — privately',
    lede: 'Pull the pages you need into a new PDF. Type ranges like “1-3, 8”; the order you type is the order you get.',
    steps: [
      'Add one PDF file.',
      'Type the pages to keep, for example “1-3, 8” or “5-” for page 5 to the end.',
      'Click “Extract pages” and download the new PDF.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I reorder pages while extracting?',
        'Yes. Pages come out in the order you type them, so “3, 1-2” puts page 3 first.',
      ],
      [
        'What happens to bookmarks and form fields?',
        'Bookmarks are kept. If a bookmark points to a page you did not keep, Fizzdoc warns you. Form fields on removed pages are removed cleanly.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'rotate',
    format: 'pdf',
    slug: 'rotate-pdf',
    name: 'Rotate PDF',
    summary: 'Turn sideways pages the right way, permanently.',
    action: 'Rotate pages',
    title: 'Rotate PDF Free — Rotate Pages Permanently, No Upload | Fizzdoc',
    description:
      'Rotate all or selected PDF pages by 90°, 180° or 270° and save the result. Runs in your browser; your file is never uploaded. Free.',
    h1: 'Rotate PDF pages and save them that way',
    lede: 'Fix sideways scans for good. Rotate every page or just the ones you choose — without re-rendering, so quality is untouched.',
    steps: [
      'Add one PDF file.',
      'Choose the angle and, optionally, which pages to rotate.',
      'Click “Rotate pages” and download the fixed PDF.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Does rotating reduce quality?',
        'No. Fizzdoc changes each page’s rotation setting; the page content is not re-rendered or re-compressed.',
      ],
      ['Can I rotate only some pages?', 'Yes. Enter pages like “2, 5-7”, or leave the field empty to rotate every page.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'delete',
    format: 'pdf',
    slug: 'delete-pdf-pages',
    name: 'Delete PDF Pages',
    summary: 'Remove pages you don’t want to share.',
    action: 'Delete pages',
    title: 'Delete PDF Pages Free — Remove Pages Online, No Upload | Fizzdoc',
    description:
      'Remove unwanted pages from a PDF in your browser. Type the pages to delete; your file never leaves your device. Free and open source.',
    h1: 'Delete pages from a PDF — privately',
    lede: 'Remove blank, duplicate or confidential pages before you share a document, without handing it to anyone.',
    steps: [
      'Add one PDF file.',
      'Type the pages to delete, for example “2, 7-9”.',
      'Click “Delete pages” and download the shorter PDF.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Are deleted pages really gone?',
        'Yes. Removed pages are not written to the new file. Your original file on your device is not changed.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'unlock',
    format: 'pdf',
    slug: 'unlock-pdf',
    name: 'Unlock PDF',
    summary: 'Save a copy without the password you know.',
    action: 'Remove password',
    title: 'Unlock PDF Free — Remove PDF Password, No Upload | Fizzdoc',
    description:
      'Remove the password from a PDF you are allowed to open. Decryption happens on your device and nothing is uploaded. Free, no sign-up.',
    h1: 'Remove a PDF password — on your device',
    lede: 'Save an unlocked copy of a protected PDF you can already open. The password and the document stay on your device.',
    steps: [
      'Add the protected PDF.',
      'Click “Remove password” and type the password when asked.',
      'Download the unlocked copy.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can Fizzdoc crack a password I do not know?',
        'No. Fizzdoc removes protection only when you know the password, or when the PDF opens without one and only restricts editing or printing. Only unlock files you have the right to modify.',
      ],
      [
        'Is my password sent anywhere?',
        'No. The password is typed into this page and used only by the engine running in your browser tab. It is not stored or logged.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'unlock',
    format: 'pdf',
    slug: 'unlock-aadhaar-pdf',
    name: 'Unlock Aadhaar PDF',
    summary: 'Remove the password from your e-Aadhaar PDF, on your device.',
    action: 'Remove password',
    title: 'Unlock Aadhaar PDF Free — Remove Password, No Upload | Fizzdoc',
    description:
      'Remove the password from your e-Aadhaar PDF for free. Type the password once and get a copy that opens anywhere. Your Aadhaar is never uploaded.',
    h1: 'Remove the password from an e-Aadhaar PDF',
    lede: 'The e-Aadhaar you download from UIDAI asks for a password every time it opens. Save a copy without it, right on your device: your Aadhaar card is never sent to any website.',
    steps: [
      'Add your e-Aadhaar PDF.',
      'Click “Remove password” and type the Aadhaar password when asked.',
      'Download the copy that opens without a password.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What is the e-Aadhaar PDF password?',
        'UIDAI sets it as the first 4 letters of your name, as printed on the Aadhaar, in CAPITAL letters, followed by your year of birth. For SURESH KUMAR born in 1990 it is SURE1990. If the name is shorter than 4 letters, use the whole name: RIA born in 1990 is RIA1990.',
      ],
      [
        'Why not just use any online unlocker?',
        'An Aadhaar card holds your name, photo, address, date of birth and Aadhaar number. Most PDF sites upload the file to their servers to unlock it. Fizzdoc does it inside your browser, so the card never leaves your phone or computer.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'unlock',
    format: 'pdf',
    slug: 'unlock-pan-card-pdf',
    name: 'Unlock e-PAN PDF',
    summary: 'Remove the password from your e-PAN card PDF.',
    action: 'Remove password',
    title: 'Unlock e-PAN PDF Free — Remove PAN Card Password, No Upload | Fizzdoc',
    description:
      'Remove the password from your e-PAN card PDF for free, so it opens without typing your date of birth. Done in your browser; your PAN is never uploaded.',
    h1: 'Remove the password from an e-PAN card PDF',
    lede: 'The e-PAN PDF from NSDL (Protean) or UTIITSL is locked with your date of birth. Save a copy that opens without it, on your own device, so your PAN card never goes to an upload site.',
    steps: [
      'Add your e-PAN PDF.',
      'Click “Remove password” and type the password when asked.',
      'Download the copy that opens without a password.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What is the e-PAN PDF password?',
        'For individuals it is the date of birth in DDMMYYYY format, without slashes: 5 March 1990 is 05031990. For a company or firm it is the date of incorporation or formation in the same format.',
      ],
      [
        'Is this allowed?',
        'Yes, for your own PAN. Fizzdoc only removes the password when you type it; it cannot open a PDF whose password you do not know.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'unlock',
    format: 'pdf',
    slug: 'unlock-bank-statement-pdf',
    name: 'Unlock Bank Statement PDF',
    summary: 'Remove the password from a bank or credit card statement PDF.',
    action: 'Remove password',
    title: 'Unlock Bank Statement PDF Free — Remove Password, No Upload | Fizzdoc',
    description:
      'Remove the password from a bank or credit card statement PDF for free, to share it for a loan, visa or tax filing. Done in your browser; never uploaded.',
    h1: 'Remove the password from a bank statement PDF',
    lede: 'Banks lock e-statements with a password, but loan, visa and tax portals often refuse locked files. Save an unlocked copy on your device: your account details never go to an upload site.',
    steps: [
      'Add the statement PDF from your bank or card provider.',
      'Click “Remove password” and type the password your bank set.',
      'Download the unlocked copy and share or upload it where you need to.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What is my bank statement password?',
        'Each bank sets its own, and states the format in the email that carries the statement. It is usually built from details such as your name, date of birth, customer ID or the last digits of your account or mobile number. Check that email, or your bank’s help page.',
      ],
      [
        'Why unlock it on my device?',
        'A statement shows your account number, balance and every transaction. Most PDF sites upload the file to unlock it; Fizzdoc does the work in your browser, so it never leaves your device.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'unlock',
    format: 'pdf',
    slug: 'unlock-itr-pdf',
    name: 'Unlock ITR PDF',
    summary: 'Remove the password from an ITR-V acknowledgement or Form 16 PDF.',
    action: 'Remove password',
    title: 'Unlock ITR PDF Free — Remove ITR-V Password, No Upload | Fizzdoc',
    description:
      'Remove the password from your ITR-V acknowledgement PDF for free, so it opens without your PAN and birth date. Works in your browser; nothing is uploaded.',
    h1: 'Remove the password from an ITR-V PDF',
    lede: 'The ITR-V acknowledgement from the income tax portal is locked with your PAN and date of birth. Save a copy that opens directly, made on your device so your tax details stay private.',
    steps: [
      'Add the ITR-V or other income tax PDF.',
      'Click “Remove password” and type the password when asked.',
      'Download the copy that opens without a password.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What is the ITR-V PDF password?',
        'Your PAN in lowercase letters followed by your date of birth in DDMMYYYY format, with no spaces: PAN ABCDE1234F born on 5 March 1990 gives abcde1234f05031990.',
      ],
      [
        'Does it work for Form 16 or other tax PDFs?',
        'Yes, for any PDF whose password you know. Fizzdoc cannot guess a password; it only removes one you type.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'protect',
    format: 'pdf',
    slug: 'protect-pdf',
    name: 'Protect PDF',
    summary: 'Lock a PDF with a password and AES-256 encryption.',
    action: 'Protect PDF',
    title: 'Password Protect PDF Free — AES-256, No Upload | Fizzdoc',
    description:
      'Add a password to a PDF with AES-256 encryption, right in your browser. The file and the password never leave your device. Free, no sign-up.',
    h1: 'Password-protect a PDF — on your device',
    lede: 'Encrypt a PDF with AES-256 so it opens only with your password. Encryption happens in this tab; neither the file nor the password is sent anywhere.',
    steps: ['Add one PDF file.', 'Type a password twice.', 'Click “Protect PDF” and download the encrypted copy.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How strong is the protection?',
        'Fizzdoc uses AES-256, the strongest encryption the PDF standard defines, via the qpdf engine. It opens in every modern PDF reader, including Adobe Acrobat, Chrome, Edge, Firefox and Preview.',
      ],
      [
        'What if I forget the password?',
        'It cannot be recovered — not by Fizzdoc, not by anyone. Keep the password somewhere safe, such as a password manager.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'clean',
    format: 'pdf',
    slug: 'remove-pdf-metadata',
    name: 'Remove PDF Metadata',
    summary: 'Strip author, title, software and XMP details.',
    action: 'Remove metadata',
    title: 'Remove PDF Metadata Free — Author, Title, XMP, No Upload | Fizzdoc',
    description:
      'Delete hidden PDF metadata such as author, title, creator app and XMP data before you share a file. Runs in your browser; nothing is uploaded. Free.',
    h1: 'Remove hidden metadata from a PDF',
    lede: 'PDFs quietly record who wrote them, with which app, and when. Strip the author, title, subject, keywords, producer and XMP metadata before you share.',
    steps: ['Add one PDF file.', 'Click “Remove metadata”.', 'Download the clean copy.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What exactly is removed?',
        'The document information dictionary (author, title, subject, keywords, creator and producer) and the XMP metadata stream. Only the modification date is kept, because the file really was just modified. Page content is untouched.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'jpg-to-pdf',
    format: 'pdf',
    slug: 'jpg-to-pdf',
    name: 'JPG to PDF',
    summary: 'Turn photos and scans into one PDF.',
    action: 'Create PDF',
    title: 'JPG to PDF Free — Convert Photos to PDF, No Upload | Fizzdoc',
    description:
      'Convert JPG, PNG, WebP and other images to a single PDF in your browser. Photos never leave your device. Free, no watermark, no sign-up.',
    h1: 'Convert JPG and PNG images to PDF — privately',
    lede: 'Combine photos, screenshots and scans into one PDF, one page per image, at full resolution. Your pictures stay on your device.',
    steps: [
      'Add one or more images — JPG, PNG, WebP, GIF and more.',
      'Put them in order with the ↑ and ↓ buttons.',
      'Click “Create PDF” and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Is image quality reduced?',
        'No. JPG and PNG images are placed in the PDF as they are, without re-compression. Other formats are converted once at high quality.',
      ],
      ['Can I convert iPhone photos?', 'Yes, if your browser can display them. Safari opens HEIC photos directly; on other browsers, share them as JPG first.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-jpg',
    format: 'pdf',
    slug: 'pdf-to-jpg',
    name: 'PDF to JPG',
    summary: 'Save every page as a sharp JPG image.',
    action: 'Convert to JPG',
    title: 'PDF to JPG Free — High-Quality Images, No Upload | Fizzdoc',
    description:
      'Convert each page of a PDF to a high-quality JPG image in your browser. Nothing is uploaded. Many pages download as one ZIP. Free.',
    h1: 'Convert PDF pages to JPG images — privately',
    lede: 'Render every page to a crisp 150 DPI JPG using Mozilla’s pdf.js, right here in your browser. A multi-page PDF downloads as one ZIP.',
    steps: ['Add one PDF file.', 'Click “Convert to JPG”.', 'Download the image, or a ZIP with one image per page.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What resolution are the images?',
        '150 DPI — sharp on screens and fine for printing at the original size. An A4 page becomes a 1240 × 1754 pixel image.',
      ],
      [
        'Does it work with password-protected PDFs?',
        'Remove the password first with Unlock PDF, then convert. Both steps stay on your device.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'audio-split',
    format: 'audio',
    slug: 'split-audio',
    name: 'Cut & Split Audio',
    summary: 'Trim an MP3 or M4A, or cut it into parts. Listen before you save.',
    action: 'Save audio',
    title: 'Cut MP3 & Split Audio Free — Trim Online, No Upload | Fizzdoc',
    description:
      'Trim an MP3 or M4A, or split it into parts at exact times. See the waveform, listen to each part, then save. No re-encoding, no upload. Free.',
    h1: 'Cut, trim and split audio in your browser',
    lede: 'Drag the handles on the waveform or type exact times, listen to what you picked, and save. Cuts are made without re-encoding, so the sound quality stays exactly the same.',
    steps: [
      'Add one MP3 or M4A file.',
      'Choose Trim to keep one part, or Split to cut it into several. Drag the handles or type times like 1:30.5, and press Preview to listen.',
      'Click “Save audio” and download your file, or all the parts in one ZIP.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will cutting lower the sound quality?',
        'No. Fizzdoc cuts between the small blocks the audio is already stored in, so nothing is re-encoded and each part sounds exactly like the original. Cuts land within a few hundredths of a second of the time you choose.',
      ],
      [
        'Which audio formats work?',
        'MP3 and M4A (including iPhone voice memos and most music files). WAV, OPUS, WebM and others are planned, and help is welcome on GitHub.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac' },
  },
  {
    op: 'audio-merge',
    format: 'audio',
    slug: 'merge-audio',
    name: 'Merge Audio',
    summary: 'Join MP3 or M4A files into one, in the order you choose.',
    action: 'Merge audio',
    title: 'Merge MP3 & M4A Free — Join Audio Online, No Upload | Fizzdoc',
    description:
      'Join MP3 or M4A files into one track in the order you choose, then listen before you download. No re-encoding, no upload, no sign-up. Free.',
    h1: 'Merge audio files into one',
    lede: 'Add your MP3 or M4A files, put them in order and join them into one track. Listen to the result before you download it; nothing is re-encoded or uploaded.',
    steps: [
      'Add two or more MP3 files, or two or more M4A files.',
      'Put them in order with the ↑ and ↓ buttons.',
      'Click “Merge audio”, listen to the result and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I merge an MP3 with an M4A?',
        'Not yet. Join files of one type at a time. Converting between formats is planned, and help is welcome on GitHub.',
      ],
      [
        'Why does it say my files use different audio settings?',
        'Files recorded at different sample rates (for example 44.1 kHz and 48 kHz) cannot be joined without re-encoding, which Fizzdoc does not do yet. Files from the same phone, app or album almost always match.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac', multiple: true },
  },
  {
    op: 'transcribe',
    format: 'audio',
    slug: 'audio-to-text',
    name: 'Audio to Text',
    summary: 'Turn speech in an audio or video file into text or subtitles.',
    action: 'Transcribe',
    title: 'Audio to Text Free — Transcribe on Your Device, No Upload | Fizzdoc',
    description:
      'Turn speech in MP3, M4A, WAV or video files into text or SRT subtitles for free. Whisper runs in your browser, so the recording is never uploaded.',
    h1: 'Convert audio to text',
    lede: 'Transcribe interviews, lectures, voice notes and meetings. The Whisper speech model runs on your device, so the recording never leaves it, and after a one-time setup it works even offline.',
    steps: TRANSCRIBE_STEPS,
    faq: [PRIVACY_FAQ[0], TRANSCRIBE_ACCURACY, TRANSCRIBE_FIRST_RUN, PRIVACY_FAQ[1]],
    input: TRANSCRIBE_IN,
  },
  {
    op: 'transcribe',
    format: 'audio',
    slug: 'mp3-to-text',
    name: 'MP3 to Text',
    summary: 'Transcribe an MP3 recording into text.',
    action: 'Transcribe MP3',
    title: 'MP3 to Text Free — Transcribe MP3 Audio, No Upload | Fizzdoc',
    description:
      'Convert MP3 audio to text for free: voice notes, podcasts, lectures and calls. Transcribed by Whisper in your browser, never uploaded. TXT or SRT.',
    h1: 'Convert MP3 to text',
    lede: 'Get the words out of an MP3: a voice note, a podcast episode, a lecture or a recorded call. Whisper transcribes it right in your browser, so nobody else ever hears the recording.',
    steps: TRANSCRIBE_STEPS,
    faq: [
      PRIVACY_FAQ[0],
      ['Does it work with WhatsApp voice notes?', 'Yes. WhatsApp voice notes are OPUS or M4A files, which Chrome, Edge and Firefox can read, and so are MP3, WAV and most phone recordings.'],
      TRANSCRIBE_FIRST_RUN,
      PRIVACY_FAQ[1],
    ],
    input: TRANSCRIBE_IN,
  },
  {
    op: 'transcribe',
    format: 'audio',
    slug: 'video-to-text',
    name: 'Video to Text',
    summary: 'Transcribe the speech in an MP4 or WebM video into text.',
    action: 'Transcribe video',
    title: 'Video to Text Free — Transcribe MP4 Speech, No Upload | Fizzdoc',
    description:
      'Turn speech in an MP4, MOV or WebM video into text or subtitles for free. Whisper reads the sound track in your browser; the video is never uploaded.',
    h1: 'Convert video to text',
    lede: 'Get a transcript of a lecture, a meeting recording, a reel or a video you downloaded. Fizzdoc reads the video’s sound track and transcribes it on your device.',
    steps: TRANSCRIBE_STEPS,
    faq: [
      PRIVACY_FAQ[0],
      ['Which videos work?', 'MP4, M4V and WebM work in every modern browser, and MOV in most. Only the sound track is used; the picture is ignored.'],
      TRANSCRIBE_ACCURACY,
      PRIVACY_FAQ[1],
    ],
    input: TRANSCRIBE_IN,
  },
  {
    op: 'transcribe',
    format: 'audio',
    slug: 'subtitle-generator',
    name: 'Subtitle Generator',
    summary: 'Create SRT or VTT subtitles from a video or audio file.',
    action: 'Create subtitles',
    title: 'Subtitle Generator Free — Video to SRT Captions, No Upload | Fizzdoc',
    description:
      'Create SRT or VTT subtitles from any video or audio for free. Timed captions are made by Whisper in your browser, and the video is never uploaded.',
    h1: 'Generate subtitles from a video',
    lede: 'Make timed captions for a video in one go: Fizzdoc listens to the sound track and writes an SRT or VTT file for YouTube, VLC, Premiere, CapCut or any video player.',
    steps: [
      'Choose a video or audio file (MP4, MOV, WebM, MP3, M4A or WAV).',
      'Pick the spoken language, or leave it on auto-detect, and choose SRT or VTT.',
      'Click “Create subtitles”, check the captions and download the file.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      ['How do I add the subtitles to my video?', 'Upload the .srt file next to your video on YouTube, Facebook or LinkedIn, or drag it into VLC, Premiere Pro, DaVinci Resolve or CapCut. VTT is the format web video players use.'],
      TRANSCRIBE_ACCURACY,
      PRIVACY_FAQ[1],
    ],
    input: TRANSCRIBE_IN,
    preset: { format: 'srt' },
  },
];

const PDF_IN = { accept: 'application/pdf,.pdf' };
const IMAGES_IN = { accept: 'image/*', multiple: true };
const SAVE_AS_PDF: [string, string] = [
  'Why does a print window open?',
  'Your browser has a built-in PDF writer that handles every language and font perfectly. Fizzdoc prepares the document and hands it to that writer: choose “Save as PDF” as the destination and click Save. Nothing is printed or sent anywhere.',
];

TOOLS.push(
  {
    op: 'compress-pdf',
    format: 'pdf',
    slug: 'compress-pdf',
    name: 'Compress PDF',
    summary: 'Shrink a PDF by optimizing its images. Text stays sharp.',
    action: 'Compress PDF',
    title: 'Compress PDF Free — Reduce PDF Size, No Upload | Fizzdoc',
    description:
      'Reduce PDF file size in your browser by recompressing oversized images. Text stays selectable and sharp. Nothing is uploaded; free and open source.',
    h1: 'Compress a PDF — without uploading it',
    lede: 'Make a PDF small enough to email or upload to a portal. Fizzdoc recompresses oversized photos and scans and leaves text and vector graphics untouched.',
    steps: ['Add one PDF file.', 'Choose Balanced or Strong compression.', 'Click “Compress PDF” and download the smaller file.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How much smaller will my PDF get?',
        'PDFs made from scans and photos often shrink by 40–80%. Text-only PDFs are usually already compact; if Fizzdoc cannot make a file smaller, it tells you and keeps the original.',
      ],
      ['Will text become blurry?', 'No. Only embedded pictures are recompressed. Text, fonts and vector drawings are copied exactly, so text stays sharp and selectable.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'edit-pdf',
    format: 'pdf',
    slug: 'edit-pdf',
    name: 'Edit PDF',
    summary: 'Change existing text, add text and white-out, right on the page.',
    action: 'Save PDF',
    title: 'Edit PDF Free — Change Text in the Same Font, No Upload | Fizzdoc',
    description:
      'Edit PDF text in its own font: click any line to change it, add text or white-out, right in your browser. Nothing is uploaded. Free, no sign-up.',
    h1: 'Edit PDF text directly on the page',
    lede: 'Fix a typo, update a date or change an amount without the original file. Click the text and type: the line keeps the PDF’s own font when it has those letters, and it all happens on your device.',
    steps: [
      'Add one PDF file.',
      'Click any text to change it, or use Add text and White-out from the toolbar.',
      'Click “Save PDF” and download the edited file.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How do I edit text in a PDF without changing the font?',
        'Click the line and type. In most PDFs, Fizzdoc rewrites the line inside the PDF with its own font, size and colour, as long as that font already has every letter you type. If one is missing, that line uses the closest standard font (sans-serif, serif or monospace) at the same size and position.',
      ],
      [
        'Is the original text removed?',
        'When the line is rewritten in the PDF’s own font, yes: the old wording is replaced in the file. With a standard font, and with White-out, the original is only covered. For sensitive information, use Redact PDF.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'redact-pdf',
    format: 'pdf',
    slug: 'redact-pdf',
    name: 'Redact PDF',
    summary: 'Black out text, signatures or photos so they’re gone for good.',
    action: 'Save redacted PDF',
    title: 'Redact PDF Free — Black Out Text for Good, No Upload | Fizzdoc',
    description:
      'Black out names, numbers, signatures or photos in a PDF and save a copy where they are really gone. Runs in your browser; nothing is uploaded. Free.',
    h1: 'Redact a PDF: black out anything, for good',
    lede: 'Drag over what should disappear, or search for a name or number and mark every match. When you save, each page becomes an image, so the hidden text can’t be copied or recovered, while the rest stays searchable.',
    steps: [
      'Add one PDF file.',
      'Drag on a page to cover an area, or type a word and click “Mark all”.',
      'Choose the quality and look, then click “Save redacted PDF” and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Is the redacted text really gone?',
        'Yes. Fizzdoc redraws every page as an image with your black marks burned in and builds a new PDF from those images. The original fonts and document metadata are not copied, and text under a mark is never added back, so it can’t be selected, searched or recovered.',
      ],
      [
        'Can I still search or copy the rest of the text?',
        'Yes. The text you didn’t cover is added back as an invisible layer over each page image, so you can search, select and copy it. Text under a mark is left out, and so is text that doesn’t show on the page, such as words already hidden under a black box. For an image-only file, untick “Keep the rest of the text searchable”.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'scan-pdf',
    format: 'pdf',
    slug: 'pdf-to-scanned-pdf',
    name: 'PDF to Scanned PDF',
    summary: 'Turn every page into an image, like a scanned document.',
    action: 'Make scanned PDF',
    title: 'PDF to Scanned PDF Free — Make It Look Scanned, No Upload | Fizzdoc',
    description:
      'Turn a PDF into an image-only scanned PDF: in colour, black and white, or with a real scanner look. Runs in your browser; nothing is uploaded. Free.',
    h1: 'Convert a PDF into a scanned PDF',
    lede: 'Every page becomes an image, so the text can’t be selected or edited. Keep the colours, go black and white, or add a slight tilt and paper grain so it looks scanned.',
    steps: [
      'Add one PDF file.',
      'Pick the quality and the look: colour, black and white, or scanned.',
      'Click “Make scanned PDF” and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Why would I want a scanned PDF?',
        'Some offices and portals ask for scanned copies, and an image-only PDF stops casual copying or editing of the text. It also flattens form fields and comments into what you see on the page.',
      ],
      [
        'Will the file get bigger?',
        'Usually, because pages are stored as pictures. Standard quality (150 DPI) keeps files small; High quality (300 DPI) keeps small print sharp.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'ocr-pdf',
    format: 'pdf',
    slug: 'ocr-pdf',
    name: 'OCR PDF',
    summary: 'Make a scanned PDF searchable and copyable.',
    action: 'Recognize text',
    title: 'OCR PDF Free — Make Scanned PDFs Searchable, No Upload | Fizzdoc',
    description:
      'Turn scanned PDFs into searchable, copyable documents with English OCR that runs in your browser. Free; pages keep their quality and nothing is uploaded.',
    h1: 'Make a scanned PDF searchable with OCR',
    lede: 'Recognize the English text in scanned pages and add it as an invisible layer, so you can search, select and copy it. The pages themselves are not changed.',
    steps: ['Add one scanned PDF.', 'Click “Recognize text” and wait while each page is read.', 'Download the searchable PDF.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Which languages are supported?',
        'English. The recognition engine (Tesseract) and its English language data are downloaded to your browser once, the first time you use an OCR tool — about a few megabytes.',
      ],
      ['Does OCR change how my pages look?', 'No. The scanned pages are kept exactly as they are; the recognized text is added as an invisible layer on top.'],
      PRIVACY_FAQ[1],
    ],
    input: PDF_IN,
  },
  {
    op: 'pdf-to-word',
    format: 'pdf',
    slug: 'pdf-to-word',
    name: 'PDF to Word',
    summary: 'Turn PDF text into an editable .docx.',
    action: 'Convert to Word',
    title: 'PDF to Word Free — Editable DOCX Converter, No Upload | Fizzdoc',
    description:
      'Convert a PDF to an editable Word document in your browser. Headings, paragraphs and page breaks are kept. Nothing is uploaded. Free, no sign-up.',
    h1: 'Convert PDF to an editable Word document',
    lede: 'Get the text of a PDF into Word, with headings and paragraphs rebuilt, so you can edit it. Conversion happens on your device.',
    steps: ['Add one PDF file.', 'Click “Convert to Word”.', 'Download the .docx and open it in Word, Google Docs or LibreOffice.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will the layout look exactly like the PDF?',
        'Fizzdoc rebuilds the text flow — headings, paragraphs, bold and italic, and page breaks — so the document is easy to edit. Complex layouts with columns, tables and images are simplified.',
      ],
      ['What about scanned PDFs?', 'Scanned pages are pictures, not text. Run OCR PDF first, then convert the result to Word.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-powerpoint',
    format: 'pdf',
    slug: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    summary: 'Turn each PDF page into a slide.',
    action: 'Convert to PowerPoint',
    title: 'PDF to PowerPoint Free — PDF to PPTX, No Upload | Fizzdoc',
    description:
      'Convert a PDF into a PowerPoint presentation with one sharp slide per page, right in your browser. Nothing is uploaded. Free and open source.',
    h1: 'Convert a PDF to a PowerPoint presentation',
    lede: 'Present a PDF as slides. Every page becomes a full-size, high-resolution slide in a .pptx you can open in PowerPoint, Keynote or Google Slides.',
    steps: ['Add one PDF file.', 'Click “Convert to PowerPoint”.', 'Download the .pptx.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I edit the text on the slides?',
        'Each slide is a picture of the page, so it looks exactly like the PDF. To edit the wording, use PDF to Word instead, or add text boxes on top in PowerPoint.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-text',
    format: 'pdf',
    slug: 'pdf-to-text',
    name: 'PDF to Text',
    summary: 'Extract all text from a PDF as a .txt file.',
    action: 'Extract text',
    title: 'PDF to Text Free — Extract Text from PDF, No Upload | Fizzdoc',
    description:
      'Extract the text from a PDF into a plain .txt file in your browser, in the right reading order. Nothing is uploaded. Free, no sign-up, open source.',
    h1: 'Extract text from a PDF',
    lede: 'Get every word out of a PDF as plain text, with lines and paragraphs in reading order. Perfect for copying, searching or feeding into other tools.',
    steps: ['Add one PDF file.', 'Click “Extract text”.', 'Download the .txt file.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Why is my text file empty?', 'Scanned PDFs contain pictures of text, not text. Run OCR PDF first, then extract the text.'],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'txt' },
  },
  {
    op: 'pdf-to-text',
    format: 'pdf',
    slug: 'pdf-to-markdown',
    name: 'PDF to Markdown',
    summary: 'Convert a PDF to clean Markdown with headings and lists.',
    action: 'Convert to Markdown',
    title: 'PDF to Markdown Free — For Docs, Notes & AI, No Upload | Fizzdoc',
    description:
      'Convert a PDF to Markdown with headings and lists detected, ready for docs, notes or AI tools. Runs in your browser; nothing is uploaded. Free.',
    h1: 'Convert a PDF to Markdown',
    lede: 'Turn a PDF into clean Markdown — headings, paragraphs and lists — for Notion, Obsidian, GitHub or any tool that reads Markdown.',
    steps: ['Add one PDF file.', 'Click “Convert to Markdown”.', 'Download the .md file.'],
    faq: [
      PRIVACY_FAQ[0],
      ['How are headings detected?', 'From the size of the text: lines noticeably larger than the body text become headings, and bulleted or numbered lines become lists.'],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'md' },
  },
  {
    op: 'text-to-pdf',
    format: 'pdf',
    slug: 'text-to-pdf',
    name: 'Text to PDF',
    summary: 'Turn a .txt file into a clean PDF.',
    action: 'Create PDF',
    title: 'Text to PDF Free — TXT to PDF in Any Language, No Upload | Fizzdoc',
    description:
      'Convert a plain text file to a clean, readable PDF in your browser. Supports every language, including Hindi and other scripts. Free; nothing is uploaded.',
    h1: 'Convert a text file to PDF',
    lede: 'Turn notes, logs or any .txt file into a neatly formatted A4 PDF. Every language and script is supported.',
    steps: ['Add one .txt file.', 'Click “Create PDF”.', 'Choose “Save as PDF” in the window that opens and click Save.'],
    faq: [PRIVACY_FAQ[0], SAVE_AS_PDF, PRIVACY_FAQ[1]],
    input: { accept: '.txt,text/plain' },
  },
  {
    op: 'text-to-pdf',
    format: 'pdf',
    slug: 'markdown-to-pdf',
    name: 'Markdown to PDF',
    summary: 'Render a .md file as a formatted PDF.',
    action: 'Create PDF',
    title: 'Markdown to PDF Free — MD to PDF Converter, No Upload | Fizzdoc',
    description:
      'Convert Markdown to a formatted PDF with headings, lists, tables and code blocks, right in your browser. Nothing is uploaded. Free and open source.',
    h1: 'Convert Markdown to PDF',
    lede: 'Render a README, notes or documentation written in Markdown into a clean, printable PDF with headings, lists, tables and code blocks.',
    steps: ['Add one .md file.', 'Click “Create PDF”.', 'Choose “Save as PDF” in the window that opens and click Save.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Which Markdown features are supported?', 'Headings, bold, italic, inline code and code blocks, ordered and bulleted lists, quotes, links, horizontal rules and tables. Raw HTML is shown as text for safety.'],
      SAVE_AS_PDF,
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.md,.markdown,text/markdown' },
  },
  {
    op: 'word-to-pdf',
    format: 'word',
    slug: 'word-to-pdf',
    name: 'Word to PDF',
    summary: 'Convert a .docx to PDF, all languages supported.',
    action: 'Convert to PDF',
    title: 'Word to PDF Free — DOCX to PDF Converter, No Upload | Fizzdoc',
    description:
      'Convert a Word document to PDF in your browser, keeping headings, lists, tables and images. Works with Google Docs downloads. Free; nothing is uploaded.',
    h1: 'Convert a Word document to PDF',
    lede: 'Turn a .docx into a PDF with its headings, lists, tables and pictures, using your browser’s own PDF writer. The document never leaves your device.',
    steps: ['Add one .docx file (from Word or Google Docs).', 'Click “Convert to PDF”.', 'Choose “Save as PDF” in the window that opens and click Save.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will it look exactly like in Word?',
        'Text, headings, lists, tables, links and pictures are kept. Headers, footers and advanced layouts such as text boxes and multi-column sections are simplified.',
      ],
      SAVE_AS_PDF,
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'excel-to-csv',
    format: 'excel',
    slug: 'excel-to-csv',
    name: 'Excel to CSV',
    summary: 'Export every sheet of an .xlsx to CSV.',
    action: 'Convert to CSV',
    title: 'Excel to CSV Free — XLSX to CSV Converter, No Upload | Fizzdoc',
    description:
      'Convert Excel spreadsheets to CSV for free in your browser. Every sheet is exported, dates become ISO dates, and nothing is uploaded. Works with Google Sheets.',
    h1: 'Convert Excel to CSV',
    lede: 'Export each sheet of an .xlsx workbook to a UTF-8 CSV file that opens correctly everywhere. Dates, numbers and text are kept as they are.',
    steps: ['Add one .xlsx file (from Excel or Google Sheets).', 'Click “Convert to CSV”.', 'Download the CSV, or a ZIP with one CSV per sheet.'],
    faq: [
      PRIVACY_FAQ[0],
      ['What happens to formulas?', 'CSV stores values only, so each cell’s last calculated value is exported — the same thing Excel does.'],
      ['Are non-English characters kept?', 'Yes. The CSV is UTF-8 with a byte-order mark, so Excel, Google Sheets and other apps read accents and non-Latin scripts correctly.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'csv-to-excel',
    format: 'excel',
    slug: 'csv-to-excel',
    name: 'CSV to Excel',
    summary: 'Turn a .csv into a proper .xlsx workbook.',
    action: 'Convert to Excel',
    title: 'CSV to Excel Free — CSV to XLSX Converter, No Upload | Fizzdoc',
    description:
      'Convert a CSV file to an Excel .xlsx workbook in your browser. Numbers stay numbers, leading zeros are kept, and nothing is uploaded. Free.',
    h1: 'Convert CSV to Excel',
    lede: 'Turn a CSV into a real Excel workbook. Numbers become numbers, codes like 007 keep their leading zeros, and the delimiter is detected for you.',
    steps: ['Add one .csv file.', 'Click “Convert to Excel”.', 'Download the .xlsx.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Does it handle semicolons and tabs?', 'Yes. Commas, semicolons, tabs and pipes are detected automatically, as are quoted fields with line breaks inside them.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.csv,.tsv,text/csv' },
  },
  {
    op: 'excel-to-json',
    format: 'excel',
    slug: 'excel-to-json',
    name: 'Excel to JSON',
    summary: 'Turn spreadsheet rows into clean JSON objects.',
    action: 'Convert to JSON',
    title: 'Excel to JSON Free — XLSX to JSON Converter, No Upload | Fizzdoc',
    description:
      'Convert Excel or Google Sheets to structured JSON for free in your browser. Each row becomes an object keyed by the header row. Nothing is uploaded.',
    h1: 'Convert Excel to JSON',
    lede: 'Turn a spreadsheet into structured JSON for an API, a database seed or your code. Each row becomes an object keyed by the column names, numbers and true/false keep their types, and every sheet is included.',
    steps: [
      'Add one .xlsx file (from Excel or Google Sheets).',
      'Keep “The first row has the column names” ticked to get objects, or untick it for plain rows.',
      'Click “Convert to JSON” and download the .json file.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What does the JSON look like?',
        'Each row becomes an object such as {"Name": "Asha", "Age": 31}. A workbook with several sheets becomes one object with a key per sheet. Empty cells are null, dates become text like 2024-05-01, and TRUE/FALSE become true/false.',
      ],
      ['What happens to formulas?', 'Each cell’s last calculated value is exported, which is the value Excel shows.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'json-to-excel',
    format: 'excel',
    slug: 'json-to-excel',
    name: 'JSON to Excel',
    summary: 'Turn JSON into a spreadsheet with a header row.',
    action: 'Convert to Excel',
    title: 'JSON to Excel Free — JSON to XLSX Converter, No Upload | Fizzdoc',
    description:
      'Convert JSON to an Excel .xlsx file for free in your browser. Objects become rows, keys become column headers and nested fields are flattened. No upload.',
    h1: 'Convert JSON to Excel',
    lede: 'Open API responses, exports and data files as a real spreadsheet. Each object becomes a row and each key a bold column header; nested fields become columns like address.city, and an object of lists becomes one sheet per list.',
    steps: ['Add one .json file.', 'Click “Convert to Excel”.', 'Download the .xlsx and open it in Excel, Google Sheets or Numbers.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Which JSON shapes work?',
        'A list of objects (the most common), a list of lists, a single object, or an object whose values are lists, which becomes one sheet per list, such as {"Customers": [...], "Orders": [...]}.',
      ],
      [
        'What happens to nested data?',
        'Nested objects become columns joined with dots, such as address.city. Lists inside a record are kept as JSON text in one cell, so nothing is lost.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.json,application/json' },
  },
  {
    op: 'mermaid-image',
    format: 'image',
    slug: 'mermaid-to-image',
    name: 'Mermaid to Image',
    summary: 'Turn Mermaid diagram code into a PNG or SVG.',
    action: 'Create image',
    title: 'Mermaid to PNG & SVG Free — Diagram to Image, No Upload | Fizzdoc',
    description:
      'Turn Mermaid code into a sharp PNG or SVG for free, right in your browser: flowcharts, sequence, class and Gantt diagrams. Nothing is uploaded.',
    h1: 'Convert Mermaid to PNG or SVG',
    lede: 'Paste Mermaid code and get an image for slides, docs, README files or chat. Flowcharts, sequence, class, state, ER and Gantt diagrams are drawn right on your device, and you see the picture before you download it.',
    steps: [
      'Paste your Mermaid code, or choose a .mmd or .md file.',
      'Pick PNG or SVG, a size and a theme.',
      'Click “Create image”, check the preview and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Which diagrams work?',
        'Everything Mermaid can draw, including flowcharts, sequence, class, state, entity-relationship, Gantt, pie, mind map, timeline and Git graphs. If the code has a mistake, Mermaid’s own message tells you what to fix.',
      ],
      [
        'PNG or SVG?',
        'SVG stays sharp at any size and is best for websites and design tools. PNG works everywhere, including Word, PowerPoint and chat apps; choose 2× or 4× for sharp slides and print.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.mmd,.mermaid,.md,.txt,text/plain' },
  },
  {
    op: 'mermaid-image',
    format: 'image',
    slug: 'mermaid-to-png',
    name: 'Mermaid to PNG',
    summary: 'Save a Mermaid diagram as a sharp PNG image.',
    action: 'Create PNG',
    title: 'Mermaid to PNG Free — Export Diagram as Image, No Upload | Fizzdoc',
    description:
      'Convert Mermaid code to a sharp PNG for free in your browser, up to 4× for slides and print, with an optional transparent background. No upload.',
    h1: 'Convert Mermaid to PNG',
    lede: 'Paste Mermaid code and download a crisp PNG that drops straight into Word, PowerPoint, Google Docs, Notion or a chat. Choose 2× or 4× for high-resolution slides and print; everything is drawn on your device.',
    steps: [
      'Paste your Mermaid code, or choose a .mmd or .md file.',
      'Pick a size (2× is sharp on most screens) and a theme.',
      'Click “Create PNG”, check the preview and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      ['How do I get a high-resolution PNG?', 'Choose 4× under PNG size. The diagram is drawn at four times its normal size, which stays sharp on large screens, in slides and in print.'],
      ['Can the PNG have a transparent background?', 'Yes. Tick “Transparent background” to place the diagram on coloured slides or dark pages.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.mmd,.mermaid,.md,.txt,text/plain' },
    preset: { format: 'png' },
  },
  {
    op: 'mermaid-image',
    format: 'image',
    slug: 'mermaid-to-svg',
    name: 'Mermaid to SVG',
    summary: 'Save a Mermaid diagram as a scalable SVG.',
    action: 'Create SVG',
    title: 'Mermaid to SVG Free — Scalable Diagram Export, No Upload | Fizzdoc',
    description:
      'Convert Mermaid code to a clean SVG for free in your browser. Sharp at any size and ready for websites, Figma and docs. Nothing is uploaded.',
    h1: 'Convert Mermaid to SVG',
    lede: 'Turn Mermaid code into a standalone SVG with a real width and height. It stays sharp at any zoom, opens in Figma, Illustrator and Inkscape, and embeds cleanly in websites and README files.',
    steps: [
      'Paste your Mermaid code, or choose a .mmd or .md file.',
      'Pick a theme, and a transparent background if you like.',
      'Click “Create SVG”, check the preview and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      ['Can I edit the SVG afterwards?', 'Yes. Text stays as real text and shapes as vector paths, so Figma, Illustrator, Inkscape and most design tools can open and edit it.'],
      ['Is the SVG safe to put on a website?', 'Mermaid runs in strict mode, which removes scripts and click handlers from labels, so the SVG holds only the drawing and its styles.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.mmd,.mermaid,.md,.txt,text/plain' },
    preset: { format: 'svg' },
  },
  {
    op: 'image-convert',
    format: 'image',
    slug: 'compress-image',
    name: 'Compress Image',
    summary: 'Make JPG, PNG and WebP images smaller.',
    action: 'Compress images',
    title: 'Compress Image Free — Reduce Size, Keep Quality, No Upload | Fizzdoc',
    description:
      'Reduce image file size in your browser — JPG, PNG, WebP and more, in bulk. Choose the quality or keep it lossless. Free; photos are never uploaded.',
    h1: 'Compress images without uploading them',
    lede: 'Shrink photos and screenshots for email, websites and forms. Pick a quality level, or keep them lossless — all on your device, in bulk.',
    steps: ['Add one or more images.', 'Choose the output format and quality.', 'Click “Compress images” and download the result.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I compress without losing quality?',
        'Yes. Choose PNG for pixel-perfect lossless output. For photos, JPG or WebP at 80% quality usually looks identical and is far smaller.',
      ],
      ['Is location data removed?', 'Yes. Re-encoding drops hidden EXIF metadata such as GPS location and camera details.'],
      PRIVACY_FAQ[1],
    ],
    input: IMAGES_IN,
    preset: { mode: 'compress' },
  },
  // Exam, job and government forms ask for photos and signatures "under 50 KB" and the like.
  ...[20, 50, 100].map(
    (kb): Tool => ({
      op: 'image-convert',
      format: 'image',
      slug: `compress-image-to-${kb}kb`,
      name: `Compress Image to ${kb} KB`,
      summary: `Get a photo or signature under ${kb} KB for an online form.`,
      action: 'Compress images',
      title: `Compress Image to ${kb} KB Free — For Forms, No Upload | Fizzdoc`,
      description: `Make a JPG, PNG or WebP photo smaller than ${kb} KB for exam, job and government forms, keeping it as sharp as possible. Free; nothing is uploaded.`,
      h1: `Compress an image to under ${kb} KB`,
      lede: `Forms often want a photo or signature under ${kb} KB. Fizzdoc keeps the picture as large and sharp as it can, lowers the JPG quality only as far as needed, and never uploads your photo.`,
      steps: [
        'Add one or more images (JPG, PNG, WebP or a phone photo).',
        `Check the limit (${kb} KB is filled in; change it if your form asks for a different size).`,
        'Click “Compress images” and download the result.',
      ],
      faq: [
        PRIVACY_FAQ[0],
        [
          'How does it keep the photo clear?',
          'Like messaging apps, it first keeps the photo about 1600 pixels on its longest side and lowers the JPG quality step by step, never below 50% while the photo is 1000 pixels or larger. Only if that is still too big does it make the picture smaller.',
        ],
        [
          'What if my form needs an exact pixel size too?',
          'Use Resize Image first to set the width and height the form asks for, then compress the result here.',
        ],
        PRIVACY_FAQ[1],
      ],
      input: IMAGES_IN,
      preset: { mode: 'compress', targetKb: String(kb) },
    }),
  ),
  {
    op: 'image-convert',
    format: 'image',
    slug: 'resize-image',
    name: 'Resize Image',
    summary: 'Make images larger or smaller, by pixels or percent.',
    action: 'Resize images',
    title: 'Resize Image Free — Change Photo Size in Pixels, No Upload | Fizzdoc',
    description:
      'Resize images to exact pixels or a percentage — smaller or larger — in your browser, in bulk. Keep the aspect ratio or not. Free; nothing is uploaded.',
    h1: 'Resize images — bigger or smaller',
    lede: 'Set an exact width and height or scale by percent, for one picture or many. Aspect ratio is kept unless you say otherwise.',
    steps: ['Add one or more images.', 'Enter a new size or a percentage.', 'Click “Resize images” and download the result.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Does enlarging an image add detail?',
        'Enlarging makes the picture bigger with smooth, high-quality scaling, but it cannot invent detail that was not captured. It is ideal for meeting minimum-size requirements.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: IMAGES_IN,
    preset: { mode: 'resize' },
  },
  {
    op: 'image-convert',
    format: 'image',
    slug: 'convert-image',
    name: 'Convert Image',
    summary: 'Convert between JPG, PNG and WebP.',
    action: 'Convert images',
    title: 'Convert Image Free — JPG, PNG, WebP Converter, No Upload | Fizzdoc',
    description:
      'Convert images between JPG, PNG and WebP for free in your browser. Works with GIF, BMP, AVIF and iPhone photos your browser can open. Nothing is uploaded.',
    h1: 'Convert images to JPG, PNG or WebP',
    lede: 'Change the format of one image or a whole batch — for example WebP to JPG or PNG to WebP — without sending them anywhere.',
    steps: ['Add one or more images.', 'Choose the format you need.', 'Click “Convert images” and download the result.'],
    faq: [PRIVACY_FAQ[0], ['Which format should I choose?', 'JPG for photos that must open everywhere, PNG for screenshots and graphics that need sharp edges or transparency, WebP for the smallest files on the web.'], PRIVACY_FAQ[1]],
    input: IMAGES_IN,
    preset: { mode: 'convert' },
  },
  {
    op: 'image-ocr',
    format: 'image',
    slug: 'image-to-text',
    name: 'Image to Text (OCR)',
    summary: 'Select and copy text from any photo or screenshot.',
    action: 'Recognize text',
    title: 'Image to Text Free — Copy Text from Photos (OCR), No Upload | Fizzdoc',
    description:
      'Extract text from photos and screenshots for free with English OCR in your browser, then select and copy it on the image, like Live Text. Nothing is uploaded.',
    h1: 'Copy text from any image',
    lede: 'Recognize the English text in a photo, scan or screenshot, then select it directly on the picture — just like Live Text on iPhone. Nothing leaves your device.',
    steps: ['Add one image.', 'Click “Recognize text”.', 'Select text right on the image, copy it all, or download it as a .txt file.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Which languages are supported?', 'English. The recognition engine and its English data download to your browser once, the first time you use OCR.'],
      ['How do I get the best results?', 'Use a sharp, well-lit, straight-on photo. Printed text works best; handwriting is recognized less reliably.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'image/*' },
  },
  {
    op: 'remove-bg',
    format: 'image',
    slug: 'remove-background',
    name: 'Remove Background',
    summary: 'Cut out a person, product or pet and put anything behind it.',
    action: 'Download image',
    title: 'Remove Background from Image Free — Full HD, No Upload | Fizzdoc',
    description:
      'Remove the background from any photo for free, at full resolution: clear PNG, white, any colour, a blur or your own photo. Nothing is uploaded.',
    h1: 'Remove the background from any photo',
    lede: 'Choose a photo and the background disappears by itself. Keep it clear, or put white, any colour, a soft blur or another photo behind. The AI runs on your own device, so your picture never leaves it.',
    steps: [
      'Choose a photo. The background is removed straight away.',
      'Pick what goes behind: nothing, a colour, a blur or your own photo. Touch up any spot if needed.',
      'Choose the size, then click “Download image”.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will my picture lose quality?',
        'No. The cut-out keeps your photo’s full resolution, with no size cap from Fizzdoc. Hair and fur edges are cleaned up at full size, so they look natural on any new background. You can also save a smaller copy.',
      ],
      [
        'How does it work without uploading?',
        'An open-source AI model (BiRefNet) runs inside your browser, on your graphics chip when the device has one. It downloads once, about 110 MB, and then works even offline. Phones with little memory use a smaller model (U²-Net).',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'image/*' },
  },
  {
    op: 'remove-bg',
    format: 'image',
    slug: 'remove-video-background',
    name: 'Remove Video Background',
    summary: 'Cut a person out of a video and put a colour, blur or photo behind. Sound included.',
    action: 'Download video',
    title: 'Remove Video Background Free — No Green Screen, No Upload | Fizzdoc',
    description:
      'Remove or change a video’s background for free, without a green screen: put a colour, a blur or a photo behind. Sound is kept and nothing is uploaded.',
    h1: 'Remove the background from a video',
    lede: 'No green screen needed. Every frame is done by an AI on your own device, the sound is kept, and you can put a colour, a blur or a photo behind. Short clips work best on phones.',
    steps: [
      'Choose a video (MP4, WebM or MOV).',
      'Pick what goes behind, using the first frame as a preview.',
      'Click “Download video” and keep the tab open while every frame is done.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How long does it take?',
        'Every frame is processed on your own device, so it depends on its speed. A recent laptop or phone with a graphics chip is fastest; older phones can take about a minute for a few seconds of video. Fizzdoc shows an estimate before you start.',
      ],
      [
        'Can I use the cut-out in a video editor?',
        'Yes. Choose “Green screen” and the person is saved on a solid green background, which video editors can remove in one click (chroma key). Videos save as MP4 where the browser can, otherwise WebM.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'video/*' },
  },
  {
    op: 'remove-bg',
    format: 'image',
    slug: 'remove-gif-background',
    name: 'Remove GIF Background',
    summary: 'Make an animated GIF’s background clear or a new colour, frame by frame.',
    action: 'Download GIF',
    title: 'Remove GIF Background Free — Transparent Animated GIF | Fizzdoc',
    description:
      'Remove the background from an animated GIF for free: every frame is cut out on your device and saved as a clear or recoloured GIF. Nothing is uploaded.',
    h1: 'Remove the background from a GIF',
    lede: 'Every frame of your animated GIF is cut out by an AI on your own device. Keep it clear, or put a colour, a blur or a photo behind, and save it as a GIF again.',
    steps: ['Choose an animated GIF.', 'Watch the preview and pick what goes behind.', 'Choose the size and click “Download GIF”.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Will the animation keep its timing?', 'Yes. Every frame keeps its own delay, and the new GIF loops like the original.'],
      [
        'Why are the edges a little sharper than in a PNG?',
        'A GIF pixel can only be fully see-through or fully solid, so soft edges can’t be kept on a clear background. For soft edges, pick a colour or a photo behind instead of “None”.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'image/gif,.gif' },
  },
  {
    op: 'remove-bg',
    format: 'image',
    slug: 'whatsapp-sticker-maker',
    name: 'WhatsApp Sticker Maker',
    summary: 'Turn any photo into a sticker: background removed, white outline, ready for WhatsApp.',
    action: 'Download sticker',
    title: 'WhatsApp Sticker Maker Free — From Any Photo, No Upload | Fizzdoc',
    description:
      'Make a WhatsApp sticker from any photo for free: the background is removed on your device and you get a 512×512 WebP with a white outline. No upload.',
    h1: 'Make a WhatsApp sticker from any photo',
    lede: 'Choose a photo of a friend, a pet or yourself. The background disappears, a white sticker outline is added, and you get a WhatsApp-ready sticker: 512 × 512 WebP, clear background, under 100 KB. The AI runs on your own device.',
    steps: [
      'Choose a photo. The background is removed and the sticker outline is added.',
      'Touch up any spot if needed, or turn the outline off.',
      'Click “Download sticker”, or on a phone tap “Share to WhatsApp”.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How do I add the sticker to WhatsApp?',
        'On a phone, tap “Share to WhatsApp” and send it to any chat (a chat with yourself works too). Then tap the sticker in the chat and choose “Add to favourites” to keep it. On a computer, download the WebP file and send it from WhatsApp Web or Desktop.',
      ],
      [
        'Is this made by WhatsApp?',
        'No. Fizzdoc is an independent, free tool and is not affiliated with WhatsApp or Meta. WhatsApp is a trademark of its owner; the name is used here only to say what the stickers are for.',
      ],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'sticker' },
    input: { accept: 'image/*' },
  },
);

// Popular searches that are the same job with a different file type get their own page and copy.
const IMAGE_CONVERSIONS = [
  { from: 'PNG', to: 'JPG', format: 'jpeg', accept: 'image/png,.png', why: 'JPG files are much smaller for photos and open everywhere, including old software and upload forms that reject PNG.' },
  { from: 'JPG', to: 'PNG', format: 'png', accept: 'image/jpeg,.jpg,.jpeg', why: 'PNG is lossless, so the picture will not lose any more quality when you edit and save it again.' },
  { from: 'WebP', to: 'JPG', format: 'jpeg', accept: 'image/webp,.webp', why: 'Many apps, printers and upload forms still cannot open WebP images saved from websites. JPG works everywhere.' },
  { from: 'JPG', to: 'WebP', format: 'webp', accept: 'image/jpeg,.jpg,.jpeg', why: 'WebP images are usually 25–35% smaller than JPG at the same visual quality, which makes websites load faster.' },
] as const;

for (const c of IMAGE_CONVERSIONS) {
  TOOLS.push({
    op: 'image-convert',
    format: 'image',
    slug: `${c.from.toLowerCase()}-to-${c.to.toLowerCase()}`,
    name: `${c.from} to ${c.to}`,
    summary: `Convert ${c.from} images to ${c.to} in bulk.`,
    action: `Convert to ${c.to}`,
    title: `${c.from} to ${c.to} Free — Convert Images Online, No Upload | Fizzdoc`,
    description: `Convert ${c.from} images to ${c.to} in your browser, one or many at once. Fast, free, no watermark, and your pictures are never uploaded.`,
    h1: `Convert ${c.from} to ${c.to} — privately`,
    lede: `${c.why} Fizzdoc converts your ${c.from} files right on your device.`,
    steps: [`Add one or more ${c.from} images.`, c.format === 'png' ? 'Nothing to set: PNG is lossless.' : 'Pick a quality, or keep the default.', `Click “Convert to ${c.to}” and download.`],
    faq: [
      PRIVACY_FAQ[0],
      [`Why convert ${c.from} to ${c.to}?`, c.why],
      ['Can I convert many images at once?', 'Yes. Add as many as you like; several images download together as one ZIP file.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: c.accept, multiple: true },
    preset: { mode: 'convert', format: c.format },
  });
}

TOOLS.push(
  {
    op: 'page-numbers',
    format: 'pdf',
    slug: 'add-page-numbers-to-pdf',
    name: 'Add Page Numbers',
    summary: 'Number every page of a PDF.',
    action: 'Add page numbers',
    title: 'Add Page Numbers to PDF Free — Online, No Upload | Fizzdoc',
    description:
      'Add page numbers to a PDF in your browser. Choose the position, the starting number and “Page 1 of 10” style. Nothing is uploaded. Free, no sign-up.',
    h1: 'Add page numbers to a PDF',
    lede: 'Number the pages of a report, thesis or contract in seconds. Pick where the numbers go and what number to start from — on your device.',
    steps: ['Add one PDF file.', 'Choose the position, style and first number.', 'Click “Add page numbers” and download.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Can I start from a number other than 1?', 'Yes. Set “Start at” to any number — useful when the PDF is a chapter of a longer document.'],
      ['Does it change my content?', 'No. The numbers are added on top of each page; everything else stays exactly as it was.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'watermark-pdf',
    format: 'pdf',
    slug: 'watermark-pdf',
    name: 'Watermark PDF',
    summary: 'Stamp text like CONFIDENTIAL across every page.',
    action: 'Add watermark',
    title: 'Watermark PDF Free — Add Text Watermark, No Upload | Fizzdoc',
    description:
      'Add a text watermark such as CONFIDENTIAL or DRAFT across every page of a PDF, in your browser. Choose the opacity. Nothing is uploaded. Free.',
    h1: 'Add a watermark to a PDF',
    lede: 'Mark a document as CONFIDENTIAL, DRAFT or with your name before sharing it. The watermark is drawn diagonally across every page.',
    steps: ['Add one PDF file.', 'Type the watermark text and choose how see-through it is.', 'Click “Add watermark” and download.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Can the watermark be removed?', 'A text watermark discourages copying but a determined person with a PDF editor can remove it. For stronger protection, also use Protect PDF.'],
      ['Which characters can I use?', 'Letters, numbers and common symbols in Latin script. Other scripts are not supported by the standard PDF fonts.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-jpg',
    format: 'pdf',
    slug: 'pdf-to-png',
    name: 'PDF to PNG',
    summary: 'Save every page as a lossless PNG image.',
    action: 'Convert to PNG',
    title: 'PDF to PNG Free — Lossless Page Images, No Upload | Fizzdoc',
    description:
      'Convert each page of a PDF to a sharp, lossless PNG image in your browser. Many pages download as one ZIP. Nothing is uploaded. Free.',
    h1: 'Convert PDF pages to PNG images',
    lede: 'Render every page to a crisp, lossless PNG — ideal for slides, documentation and screenshots with sharp text. Nothing leaves your device.',
    steps: ['Add one PDF file.', 'Click “Convert to PNG”.', 'Download the image, or a ZIP with one PNG per page.'],
    faq: [
      PRIVACY_FAQ[0],
      ['PNG or JPG?', 'PNG keeps text and lines perfectly sharp but files are larger. For photos and scans, PDF to JPG gives much smaller files.'],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'png' },
  },
  {
    op: 'split',
    format: 'pdf',
    slug: 'extract-pdf-pages',
    name: 'Extract PDF Pages',
    summary: 'Save selected pages as a new PDF.',
    action: 'Extract pages',
    title: 'Extract PDF Pages Free — Save Pages as New PDF, No Upload | Fizzdoc',
    description:
      'Pull specific pages out of a PDF into a new file, in your browser. Type pages like 2, 5-7. Links and form fields are kept. Nothing is uploaded. Free.',
    h1: 'Extract pages from a PDF',
    lede: 'Need just the signature page or one chapter? Type the pages you want and get them as a new PDF — the original stays untouched.',
    steps: ['Add one PDF file.', 'Type the pages to extract, for example “2, 5-7”.', 'Click “Extract pages” and download the new PDF.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Is the quality reduced?', 'No. Pages are copied as they are — nothing is re-rendered or re-compressed.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'split',
    format: 'pdf',
    slug: 'reorder-pdf-pages',
    name: 'Reorder PDF Pages',
    summary: 'Put the pages of a PDF in a new order.',
    action: 'Reorder pages',
    title: 'Reorder PDF Pages Free — Rearrange Pages, No Upload | Fizzdoc',
    description:
      'Rearrange the pages of a PDF by typing the order you want, like 3, 1-2, 4-. Runs in your browser; your file is never uploaded. Free, no sign-up.',
    h1: 'Reorder the pages of a PDF',
    lede: 'Fix pages that were scanned out of order or move an appendix to the front. Type the new order and download the rearranged PDF.',
    steps: ['Add one PDF file.', 'Type the new page order, for example “3, 1-2, 4-”.', 'Click “Reorder pages” and download.'],
    faq: [
      PRIVACY_FAQ[0],
      ['How do I write the order?', 'List pages and ranges separated by commas. “4-” means page 4 to the end. Pages you leave out are left out of the new file.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'jpg-to-pdf',
    format: 'pdf',
    slug: 'png-to-pdf',
    name: 'PNG to PDF',
    summary: 'Turn PNG screenshots and images into one PDF.',
    action: 'Create PDF',
    title: 'PNG to PDF Free — Screenshots to One PDF, No Upload | Fizzdoc',
    description:
      'Combine PNG screenshots and images into a single PDF in your browser, one page per image, at full quality. Nothing is uploaded. Free, no watermark.',
    h1: 'Convert PNG images to PDF',
    lede: 'Put screenshots, diagrams or scanned pages saved as PNG into one tidy PDF — sharp, lossless and in the order you choose.',
    steps: ['Add one or more PNG images.', 'Put them in order with the ↑ and ↓ buttons.', 'Click “Create PDF” and download it.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Is transparency kept?', 'Yes. PNG images are placed in the PDF as they are, including transparent areas.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'image/png,.png', multiple: true },
  },
);

// Word, Excel and PowerPoint files (and Google Docs, Sheets and Slides downloaded as them) are ZIP
// packages, so the same two tools work for all three; only the words change.
const OFFICE = [
  { format: 'word', app: 'Word', ext: 'docx', google: 'Google Docs', thing: 'document', a: 'a' },
  { format: 'excel', app: 'Excel', ext: 'xlsx', google: 'Google Sheets', thing: 'spreadsheet', a: 'an' },
  { format: 'powerpoint', app: 'PowerPoint', ext: 'pptx', google: 'Google Slides', thing: 'presentation', a: 'a' },
] as const;

const googleFaq = (o: (typeof OFFICE)[number]): [string, string] => [
  `Does it work with ${o.google}?`,
  `Yes. In ${o.google}, choose File → Download → Microsoft ${o.app} (.${o.ext}), then add that file here. Nothing is sent to Google or to us.`,
];

for (const o of OFFICE) {
  TOOLS.push(
    {
      op: 'office-clean',
      format: o.format,
      slug: `remove-${o.format}-metadata`,
      name: `Remove ${o.app} Metadata`,
      summary: `Erase author, company and editor names from a .${o.ext}.`,
      action: 'Remove metadata',
      title: `Remove ${o.app} Metadata Free — Clean ${o.ext.toUpperCase()}, No Upload | Fizzdoc`,
      description: `Delete author, editor, company, title and thumbnail from ${o.a} ${o.app} file in your browser. Works with ${o.google} downloads. Free; nothing is uploaded.`,
      h1: `Remove hidden metadata from ${o.a} ${o.app} ${o.thing}`,
      lede: `Every .${o.ext} records who created it, who edited it last and which company it belongs to. Erase those details before you send it — without uploading the file anywhere.`,
      steps: [`Add one .${o.ext} file (from ${o.app} or ${o.google}).`, 'Click “Remove metadata”.', `Download the clean .${o.ext}.`],
      faq: [
        PRIVACY_FAQ[0],
        [
          'What is removed?',
          'Author, last modified by, title, subject, description, keywords, category, status, company, manager, hyperlink base, custom properties and the embedded preview thumbnail. Created and modified dates are kept because Office needs them. Your content is not touched.',
        ],
        googleFaq(o),
        PRIVACY_FAQ[1],
      ],
    },
    {
      op: 'office-images',
      format: o.format,
      slug: `extract-images-from-${o.format}`,
      name: `Extract Images from ${o.app}`,
      summary: `Save every picture in a .${o.ext} at original quality.`,
      action: 'Extract images',
      title: `Extract Images from ${o.app} Free — ${o.ext.toUpperCase()} to ZIP, No Upload | Fizzdoc`,
      description: `Download every picture embedded in ${o.a} ${o.app} ${o.thing} as a ZIP, at original resolution. Works with ${o.google} downloads. Free; runs in your browser.`,
      h1: `Extract all images from ${o.a} ${o.app} ${o.thing}`,
      lede: `Get every photo, logo and chart image out of a .${o.ext} in its original format and resolution — no screenshots, no re-compression, no upload.`,
      steps: [`Add one .${o.ext} file (from ${o.app} or ${o.google}).`, 'Click “Extract images”.', 'Download the ZIP of images.'],
      faq: [
        PRIVACY_FAQ[0],
        [
          'Are the images reduced in quality?',
          'No. They are copied out exactly as they are stored inside the file, in their original format (PNG, JPG, GIF, SVG, EMF and so on).',
        ],
        googleFaq(o),
        PRIVACY_FAQ[1],
      ],
    },
    {
      op: 'office-compress',
      format: o.format,
      slug: `compress-${o.format}`,
      name: `Compress ${o.app}`,
      summary: `Shrink a .${o.ext} by optimizing its pictures.`,
      action: `Compress ${o.app}`,
      title: `Compress ${o.app} File Free — Reduce ${o.ext.toUpperCase()} Size, No Upload | Fizzdoc`,
      description: `Reduce the size of ${o.a} ${o.app} file by recompressing its photos, in your browser. Content and formatting stay the same. Free; nothing is uploaded.`,
      h1: `Compress ${o.a} ${o.app} ${o.thing}`,
      lede: `Make a .${o.ext} small enough to email by recompressing oversized photos inside it. Text, formatting and everything else stay exactly the same.`,
      steps: [`Add one .${o.ext} file (from ${o.app} or ${o.google}).`, 'Choose Balanced or Strong compression.', `Click “Compress ${o.app}” and download the smaller file.`],
      faq: [
        PRIVACY_FAQ[0],
        [
          'How much smaller will it get?',
          'Files with large photos often shrink by half or more. Files that are mostly text are already compact; if Fizzdoc cannot make a file smaller, it tells you and keeps the original.',
        ],
        googleFaq(o),
        PRIVACY_FAQ[1],
      ],
    },
  );
}

/** Real search phrases per tool, English; translations carry their own. */
const KEYWORDS: Record<string, string[]> = {
  'merge-pdf': [
    'combine PDF files into one',
    'merge PDF without uploading',
    'join PDF files online free',
    'merge scanned PDFs',
    'merge PDF on phone'
  ],
  'split-pdf': [
    'split PDF into separate pages',
    'separate one page from a PDF',
    'split a large PDF into parts',
    'cut PDF pages online free',
    'split PDF without software'
  ],
  'rotate-pdf': [
    'rotate PDF and save',
    'fix a sideways scanned PDF',
    'rotate one page in a PDF',
    'turn PDF pages 90 degrees',
    'rotate PDF online free'
  ],
  'delete-pdf-pages': [
    'remove pages from a PDF',
    'delete a blank page in a PDF',
    'delete PDF pages without Acrobat',
    'remove the last page of a PDF',
    'delete pages from PDF free'
  ],
  'unlock-pdf': [
    'remove password from PDF',
    'unlock a bank statement PDF',
    'stop a PDF asking for its password',
    'remove PDF restrictions',
    'unlock PDF free online'
  ],
  'unlock-aadhaar-pdf': ['Aadhaar PDF password', 'e-Aadhaar password remove', 'open Aadhaar card PDF without password', 'Aadhaar PDF unlock online free', 'masked Aadhaar PDF password'],
  'unlock-pan-card-pdf': ['e-PAN PDF password', 'PAN card PDF password remove', 'NSDL e-PAN password', 'open PAN card PDF', 'UTIITSL e-PAN password'],
  'unlock-bank-statement-pdf': ['bank statement PDF password remove', 'credit card statement unlock', 'unlock bank statement for loan', 'remove password from e-statement', 'statement PDF without password'],
  'unlock-itr-pdf': ['ITR-V password', 'ITR acknowledgement PDF password', 'Form 16 PDF password remove', 'open ITR PDF', 'income tax PDF unlock'],
  'protect-pdf': [
    'add a password to a PDF',
    'encrypt PDF with AES-256',
    'lock a PDF file',
    'password protect PDF without Acrobat',
    'secure PDF before emailing'
  ],
  'remove-pdf-metadata': [
    'remove author name from PDF',
    'clean PDF metadata before sharing',
    'delete hidden data in a PDF',
    'strip XMP metadata',
    'anonymise a PDF'
  ],
  'jpg-to-pdf': [
    'convert photos to PDF',
    'combine images into one PDF',
    'image to PDF converter free',
    'JPG to PDF on phone',
    'make a PDF from pictures'
  ],
  'pdf-to-jpg': [
    'convert PDF pages to images',
    'save PDF as JPG',
    'PDF to image high quality',
    'extract a page from PDF as a picture',
    'PDF to JPG on phone'
  ],
  'split-audio': [
    'cut MP3 online free',
    'trim audio file',
    'split MP3 into parts',
    'make a ringtone from a song',
    'cut M4A without re-encoding'
  ],
  'merge-audio': [
    'join MP3 files into one',
    'combine audio files online',
    'merge songs without losing quality',
    'join voice notes',
    'merge M4A files free'
  ],
  'compress-pdf': [
    'reduce PDF file size',
    'compress PDF without losing quality',
    'make PDF smaller for email',
    'compress PDF to upload on a portal',
    'shrink scanned PDF size'
  ],
  'edit-pdf': [
    'edit text in a PDF',
    'change words in a PDF free',
    'add text to a PDF',
    'edit PDF text in the same font',
    'PDF editor without sign-up'
  ],
  'redact-pdf': [
    'black out text in a PDF',
    'hide personal information in a PDF',
    'redact PDF without Acrobat Pro',
    'remove sensitive data from PDF',
    'censor names in a PDF'
  ],
  'pdf-to-scanned-pdf': [
    'make a PDF look scanned',
    'flatten PDF to images',
    'convert PDF to image-only PDF',
    'black and white scan effect',
    'stop text copying from a PDF'
  ],
  'ocr-pdf': [
    'make scanned PDF searchable',
    'OCR PDF free',
    'copy text from scanned PDF',
    'convert scanned PDF to text',
    'searchable PDF without upload'
  ],
  'pdf-to-word': [
    'convert PDF to editable Word',
    'PDF to DOCX free',
    'edit a PDF in Word',
    'PDF to Word with headings kept',
    'PDF to Word on phone'
  ],
  'pdf-to-powerpoint': [
    'convert PDF to slides',
    'PDF to PPT free',
    'present a PDF in PowerPoint',
    'PDF to presentation',
    'PDF to Google Slides'
  ],
  'pdf-to-text': [
    'extract text from PDF',
    'copy all text from a PDF',
    'PDF to TXT free',
    'PDF to plain text',
    'get text out of a PDF'
  ],
  'pdf-to-markdown': [
    'convert PDF to Markdown for ChatGPT',
    'PDF to MD free',
    'PDF to Notion or Obsidian',
    'extract PDF headings and lists',
    'prepare a PDF for an AI tool'
  ],
  'text-to-pdf': [
    'convert TXT to PDF',
    'save notes as PDF',
    'Hindi text to PDF',
    'plain text to PDF free',
    'make a PDF from text'
  ],
  'markdown-to-pdf': [
    'convert README to PDF',
    'MD to PDF free',
    'print Markdown as PDF',
    'Markdown with tables to PDF',
    'export Markdown notes as PDF'
  ],
  'word-to-pdf': [
    'convert DOCX to PDF',
    'save Word as PDF free',
    'Google Docs to PDF',
    'resume to PDF',
    'Word to PDF on phone'
  ],
  'excel-to-csv': [
    'convert XLSX to CSV',
    'export Excel sheet as CSV',
    'Google Sheets to CSV',
    'Excel to CSV with all sheets',
    'XLSX to CSV free'
  ],
  'csv-to-excel': [
    'open CSV in Excel correctly',
    'CSV to XLSX free',
    'keep leading zeros in CSV',
    'convert CSV to spreadsheet',
    'CSV to Excel on phone'
  ],
  'excel-to-json': ['convert Excel to JSON', 'XLSX to JSON array of objects', 'Google Sheets to JSON', 'spreadsheet to JSON for an API', 'Excel to JSON with headers'],
  'json-to-excel': ['convert JSON to Excel', 'JSON to XLSX online free', 'open a JSON file in Excel', 'API response to spreadsheet', 'nested JSON to Excel'],
  'mermaid-to-image': ['Mermaid to PNG', 'Mermaid to SVG online free', 'export Mermaid diagram as image', 'Mermaid flowchart to picture', 'Mermaid live editor alternative'],
  'mermaid-to-png': ['Mermaid to PNG converter', 'export Mermaid diagram as PNG', 'Mermaid PNG high resolution', 'Mermaid diagram with transparent background', 'Mermaid flowchart to PNG'],
  'mermaid-to-svg': ['Mermaid to SVG converter', 'export Mermaid diagram as SVG', 'Mermaid SVG download', 'Mermaid diagram for Figma', 'Mermaid chart to vector image'],
  'audio-to-text': ['transcribe audio to text free', 'speech to text online', 'voice recording to text', 'transcribe interview or lecture', 'private transcription without upload'],
  'mp3-to-text': ['convert MP3 to text', 'transcribe podcast', 'WhatsApp voice note to text', 'voice memo to text', 'audio file to text free'],
  'video-to-text': ['convert MP4 to text', 'transcribe video to text', 'lecture video transcript', 'meeting recording to text', 'get text from a video'],
  'subtitle-generator': ['SRT subtitle generator', 'auto captions for video', 'generate subtitles from video free', 'video to SRT', 'subtitles for YouTube'],
  'compress-image': [
    'compress image without losing quality',
    'reduce photo size',
    'compress JPG and PNG in bulk',
    'make images smaller for a website',
    'reduce image size in KB'
  ],
  'compress-image-to-20kb': [
    'reduce photo size to 20 KB',
    'signature image under 20 KB',
    'compress photo for exam form',
    'resize image to 20 KB for SSC or UPSC form',
    'JPG under 20 KB'
  ],
  'compress-image-to-50kb': [
    'reduce photo size to 50 KB',
    'passport photo under 50 KB',
    'compress image for government form',
    'resize image to 50 KB online',
    'JPG under 50 KB'
  ],
  'compress-image-to-100kb': [
    'reduce photo size to 100 KB',
    'compress image for job application',
    'photo under 100 KB for online form',
    'resize image to 100 KB online',
    'JPG under 100 KB'
  ],
  'resize-image': [
    'resize image to exact pixels',
    'change photo dimensions',
    'resize photo for passport or visa',
    'bulk resize images',
    'enlarge or shrink an image'
  ],
  'convert-image': [
    'convert AVIF or BMP to JPG',
    'change image format',
    'convert GIF or BMP to PNG',
    'bulk image converter',
    'image to WebP'
  ],
  'remove-video-background': [
    'remove background from video free',
    'video background remover',
    'change video background',
    'remove video background without green screen',
    'transparent background video',
  ],
  'whatsapp-sticker-maker': [
    'whatsapp sticker maker',
    'make sticker from photo',
    'photo to whatsapp sticker',
    'personal sticker maker online',
    'transparent sticker webp 512',
  ],
  'remove-gif-background': [
    'remove gif background',
    'transparent gif maker',
    'make gif background transparent',
    'gif background remover free',
    'change animated gif background',
  ],
  'remove-background': [
    'remove background from image free',
    'make background transparent',
    'change photo background to white',
    'remove bg online without uploading',
    'background eraser for photos',
  ],
  'image-to-text': [
    'copy text from a photo',
    'screenshot to text',
    'extract text from image free',
    'OCR image to text',
    'copy text from a phone photo'
  ],
  'png-to-jpg': [
    'convert PNG to JPG free',
    'PNG to JPEG',
    'make PNG smaller',
    'screenshot to JPG',
    'bulk PNG to JPG'
  ],
  'jpg-to-png': [
    'convert JPG to PNG free',
    'JPEG to PNG',
    'save photo as PNG',
    'lossless image copy',
    'bulk JPG to PNG'
  ],
  'webp-to-jpg': [
    'convert WebP to JPG free',
    'open WebP image',
    'WebP to JPEG',
    'save WebP as JPG',
    'bulk WebP to JPG'
  ],
  'jpg-to-webp': [
    'convert JPG to WebP free',
    'make images smaller for a website',
    'JPEG to WebP',
    'WebP converter',
    'bulk JPG to WebP'
  ],
  'add-page-numbers-to-pdf': [
    'number PDF pages',
    'add Page 1 of 10 to a PDF',
    'insert page numbers in PDF free',
    'page numbers for a thesis PDF',
    'page numbers at the bottom of a PDF'
  ],
  'watermark-pdf': [
    'add CONFIDENTIAL to a PDF',
    'stamp DRAFT on PDF pages',
    'watermark PDF free',
    'add text watermark to PDF',
    'watermark in Hindi or any language'
  ],
  'pdf-to-png': [
    'convert PDF to PNG',
    'PDF page to image lossless',
    'sharp PDF page images for slides',
    'save PDF slides as PNG',
    'PDF to PNG free'
  ],
  'extract-pdf-pages': [
    'save one page of a PDF',
    'extract pages as new PDF',
    'take pages out of a PDF',
    'copy pages from a PDF',
    'extract PDF pages free'
  ],
  'reorder-pdf-pages': [
    'rearrange PDF pages',
    'change page order in PDF',
    'move pages in a PDF',
    'sort PDF pages',
    'reorder PDF free'
  ],
  'png-to-pdf': [
    'convert screenshots to PDF',
    'PNG to PDF free',
    'combine PNG images into PDF',
    'image to PDF without quality loss',
    'PNG to PDF on phone'
  ],
  'remove-word-metadata': [
    'remove author from Word document',
    'clean DOCX before sharing',
    'delete Word document properties',
    'anonymise a Word file',
    'remove company name from DOCX'
  ],
  'extract-images-from-word': [
    'save all images from a Word file',
    'download pictures from DOCX',
    'get photos out of Google Docs',
    'extract images from DOCX free',
    'Word images at full resolution'
  ],
  'compress-word': [
    'reduce Word file size',
    'compress DOCX with images',
    'make Word document smaller for email',
    'shrink DOCX',
    'compress Word free'
  ],
  'remove-excel-metadata': [
    'remove author from Excel file',
    'clean XLSX before sharing',
    'delete Excel document properties',
    'anonymise a spreadsheet',
    'remove company name from XLSX'
  ],
  'extract-images-from-excel': [
    'save all images from an Excel file',
    'download pictures from XLSX',
    'get images out of Google Sheets',
    'extract images from XLSX free',
    'Excel images at full resolution'
  ],
  'compress-excel': [
    'reduce Excel file size',
    'compress XLSX with images',
    'make spreadsheet smaller for email',
    'shrink XLSX',
    'compress Excel free'
  ],
  'remove-powerpoint-metadata': [
    'remove author from PowerPoint',
    'clean PPTX before sharing',
    'delete presentation properties',
    'anonymise a presentation',
    'remove company name from PPTX'
  ],
  'extract-images-from-powerpoint': [
    'save all images from a presentation',
    'download pictures from PPTX',
    'get images out of Google Slides',
    'extract images from PPTX free',
    'slides images at full resolution'
  ],
  'compress-powerpoint': [
    'reduce PowerPoint file size',
    'compress PPTX with images',
    'make presentation smaller for email',
    'shrink PPTX',
    'compress PowerPoint free'
  ]
};
for (const tool of TOOLS) tool.keywords = KEYWORDS[tool.slug];

export const FORMATS: Record<Format, { label: string; badge: string; ext: string }> = {
  pdf: { label: 'PDF', badge: 'PDF', ext: 'pdf' },
  word: { label: 'Word', badge: 'DOC', ext: 'docx' },
  excel: { label: 'Excel', badge: 'XLS', ext: 'xlsx' },
  powerpoint: { label: 'PowerPoint', badge: 'PPT', ext: 'pptx' },
  image: { label: 'Image', badge: 'IMG', ext: 'jpg' },
  audio: { label: 'Audio', badge: 'MP3', ext: 'mp3' },
};

export const HOME = {
  title: 'Fizzdoc — Free PDF, Image, Audio & Office Tools. No Uploads.',
  description:
    'Free forever: private tools to edit, compress, convert and OCR PDFs, images, audio and Office files in your browser. No uploads, no sign-up, 16 languages.',
  h1: 'Document tools that never see your documents',
  lede: 'Edit, compress, convert and OCR PDFs. Convert Word, Excel, PowerPoint and images, and cut or join audio. Everything runs in your browser — your files never leave your device.',
  what: 'Fizzdoc is a free, open-source set of document tools that runs entirely in your web browser. PDFs are processed with the qpdf, pdf.js and pdf-lib engines, text recognition uses Tesseract, and Office files and images are handled locally too — so nothing is ever uploaded to a server.',
  faq: [
    PRIVACY_FAQ[0],
    [
      'Is it safe to use for bank statements, ID cards or medical records?',
      'Yes. The file is opened and processed inside your browser tab and is never sent anywhere, so there is no copy on a server that could leak, be sold or be hacked. Your browser enforces this, you can confirm it in the Network tab, and closing the tab clears everything.',
    ],
    [
      'How is Fizzdoc different from other online PDF tools?',
      'Many online PDF tools process your document on their own servers. Fizzdoc does the work in your browser tab instead, so there is nothing to upload, store or delete afterwards. It is also open source, and it warns you whenever something such as a bookmark cannot be carried over instead of silently dropping it.',
    ],
    [
      'Does it work with Google Docs, Sheets and Slides?',
      'Yes. Download the file from Google as a Word, Excel or PowerPoint file (File → Download) and use the matching Fizzdoc tool. Nothing is sent to Google or to Fizzdoc.',
    ],
    [
      'Does it work on my phone?',
      'Yes. Fizzdoc works in current versions of Chrome, Safari, Firefox and Edge on desktop and mobile. Very large files may exceed a phone’s memory; Fizzdoc checks this before starting.',
    ],
    PRIVACY_FAQ[1],
  ] as [string, string][],
};
