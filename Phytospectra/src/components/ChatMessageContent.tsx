import { memo, type ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

/** Split inline numbered / bullet items onto separate lines for readable layout. */
function normalizeAssistantText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s+(?=\d+\.\s)/g, "\n")
    .replace(/\s+(?=[-*•]\s)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const ChatMessageContent = memo(function ChatMessageContent({ text }: { text: string }) {
  const normalized = normalizeAssistantText(text);
  const lines = normalized.split("\n");

  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let numbered: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const content = paragraph.join(" ").trim();
    if (content) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="leading-relaxed [&:not(:first-child)]:mt-3">
          {renderInline(content)}
        </p>,
      );
    }
    paragraph = [];
  };

  const flushNumbered = () => {
    if (!numbered.length) return;
    blocks.push(
      <ol
        key={`ol-${blocks.length}`}
        className="mt-3 list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-foreground/80"
      >
        {numbered.map((item, i) => (
          <li key={i} className="leading-relaxed pl-1">
            {renderInline(item)}
          </li>
        ))}
      </ol>,
    );
    numbered = [];
  };

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="mt-3 list-disc space-y-2 pl-5 marker:text-primary"
      >
        {bullets.map((item, i) => (
          <li key={i} className="leading-relaxed pl-0.5">
            {renderInline(item)}
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushNumbered();
    flushBullets();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushAll();
      continue;
    }

    const numberedMatch = line.match(/^\d+\.\s+(.*)$/);
    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);

    if (numberedMatch) {
      flushParagraph();
      flushBullets();
      numbered.push(numberedMatch[1]);
      continue;
    }

    if (bulletMatch) {
      flushParagraph();
      flushNumbered();
      bullets.push(bulletMatch[1]);
      continue;
    }

    flushNumbered();
    flushBullets();
    paragraph.push(line);
  }

  flushAll();

  if (!blocks.length) {
    return <p className="leading-relaxed">{renderInline(text)}</p>;
  }

  return <div className="space-y-0.5">{blocks}</div>;
});
