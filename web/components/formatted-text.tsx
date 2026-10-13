import type { CSSProperties } from "react";
import { cn } from "@/lib/format";
import { formatSegments, tagColors, type FormatTag } from "@/lib/message-format";

const tagClasses: Readonly<Partial<Record<FormatTag, string>>> = { b: "font-bold", i: "italic", big: "text-[1.2em]", small: "text-[0.85em]" };

function decoration(tags: readonly FormatTag[]): CSSProperties["textDecorationLine"] {
  const lines = [tags.includes("u") ? "underline" : "", tags.includes("s") ? "line-through" : ""].filter((line) => line !== "");
  return lines.length === 0 ? undefined : lines.join(" ");
}

// A message's text shown the way Zalo will show it, its formatting tags turned into the formatting they stand for.
export function FormattedText({ text }: { text: string }) {
  return (
    <>
      {formatSegments(text).map((segment, index) => {
        if (segment.mention) return <span key={index} className="font-medium text-accent">{segment.text}</span>;
        if (segment.tags.length === 0) return segment.text;
        // The innermost colour is the one that shows.
        const color = segment.tags.map((tag) => tagColors[tag]).filter((value) => value !== undefined).at(-1);
        return (
          <span key={index} className={cn(...segment.tags.map((tag) => tagClasses[tag]))} style={{ color, textDecorationLine: decoration(segment.tags) }}>
            {segment.text}
          </span>
        );
      })}
    </>
  );
}
