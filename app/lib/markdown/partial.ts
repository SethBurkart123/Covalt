/**
 * Streaming Markdown preprocessor.
 *
 * Ported from liveblocks-react-ui's Markdown primitive
 * (https://github.com/liveblocks/liveblocks/blob/main/packages/liveblocks-react-ui/src/primitives/Markdown.tsx)
 * and adapted to operate as a pure string-in / string-out transform so it can
 * sit in front of any Markdown parser (md4w, marked, remark, ...).
 *
 * Goals while streaming tokens from an LLM:
 *   - Close partial inline syntax (bold, italic, strike, inline code, links).
 *   - Buffer incomplete things that would render poorly (partial images,
 *     half-formed emoji clusters, dangling delimiters).
 *   - Optimistically materialize a table when the user has just typed the
 *     header row, by synthesizing the separator row below it.
 */

const LIST_ITEM_CHECKBOX_REGEX = /^\[\s?(x)?\]?$/i;
const PARTIAL_LINK_IMAGE_REGEX =
  /(?<!\\)(?<image>!)?\[(?!\^)(?<text>[^\]]*)(?:\](?:\((?<url>[^)]*)?)?)?$/;
// A reference-style link in progress: "[text][label" or "[text][label]" with
// no inline url. We must NOT treat "[label" as a new partial link, otherwise
// the first bracket pair leaks as raw text and the second gets auto-closed.
const PARTIAL_REFERENCE_LINK_REGEX =
  /(?<!\\)(?<image>!)?\[(?!\^)(?<text>[^\]\n]*)\]\[(?<ref>[^\]\n]*)\]?$/;
const REFERENCE_LINK_REGEX =
  /(?<!\\)(?<image>!)?\[(?!\^)(?<text>[^\]\n]+)\]\[(?<ref>[^\]\n]+)\]/g;
const REFERENCE_DEFINITION_REGEX =
  /^(?<prefix>\s{0,3}\[[^\]\n]+\]:\s+)(?<url><[^>\n]*>|\S+)(?<rest>.*)$/;
const PARTIAL_TABLE_HEADER_REGEX =
  /^\s*\|(?:[^|\n]+(?:\|[^|\n]+)*?)?\|?\s*(?:\n\s*\|\s*[-:|\s]*\s*)?$/;
const PARTIAL_EMOJI_REGEX =
  /(?:\u200D|\uFE0F|\u20E3|\p{Regional_Indicator}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Modifier})+$/u;
const WHITESPACE_REGEX = /\s/;
const NEWLINE_REGEX = /\r\n?/g;
const BUFFERED_CHARACTERS_REGEX =
  /(?<!\\)((\*+|_+|~+|`+|\++|-{0,2}|={0,2}|\\|!|<\/?)\s*)$/;
const SINGLE_CHARACTER_REGEX = /^\s*(\S\s*)$/;
const DEFAULT_PARTIAL_LINK_URL = "#";

function normalizeNewlines(input: string): string {
  return input.replace(NEWLINE_REGEX, "\n");
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Strip dangling characters from the very end of the input so the downstream
 * parser doesn't misread a half-typed delimiter. Mirrors liveblocks'
 * `trimPartialMarkdown`.
 */
function trimPartialMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  if (lines.length === 0) return markdown;

  const lastLine = lines[lines.length - 1]!;

  const [singleCharacterMatch] = lastLine.match(SINGLE_CHARACTER_REGEX) ?? [];
  if (singleCharacterMatch) {
    lines[lines.length - 1] = lastLine.slice(0, -singleCharacterMatch.length);
    return lines.join("\n");
  }

  const [bufferedCharactersMatch] = lastLine.match(BUFFERED_CHARACTERS_REGEX) ?? [];
  if (bufferedCharactersMatch) {
    lines[lines.length - 1] = lastLine.slice(0, -bufferedCharactersMatch.length);
    return lines.join("\n");
  }

  return markdown;
}

interface StackEntry {
  string: string;
  length: number;
  index: number;
}

/**
 * Optimistically close trailing inline markup. Returns a new string with
 * delimiters (` * _ ~) balanced, partial links completed with a placeholder
 * href, partial images dropped, and dangling emoji clusters trimmed.
 */
function completePartialInlineMarkdown(
  markdown: string,
  options: { allowLinksImages?: boolean } = {},
): string {
  const stack: StackEntry[] = [];
  const allowLinksImages = options.allowLinksImages ?? true;
  let completedMarkdown = markdown;

  const partialEmojiMatch = completedMarkdown.match(PARTIAL_EMOJI_REGEX);
  if (partialEmojiMatch) {
    const partialEmoji = partialEmojiMatch[0];
    completedMarkdown = completedMarkdown.slice(0, -partialEmoji.length);

    // Variation Selector-16 and the keycap combiner modify the preceding
    // codepoint; if we removed one, the codepoint they were attached to is
    // now visually meaningless on its own, so drop it too.
    if (partialEmoji.includes("\uFE0F") || partialEmoji.includes("\u20E3")) {
      const codepoints = Array.from(completedMarkdown);
      if (codepoints.length > 0) {
        completedMarkdown = codepoints.slice(0, -1).join("");
      }
    }
  }

  for (let i = 0; i < completedMarkdown.length; i++) {
    const character = completedMarkdown[i]!;
    const isEscaped = i > 0 ? completedMarkdown[i - 1] === "\\" : false;
    if (isEscaped) continue;

    if (character === "`") {
      const lastDelimiter = stack[stack.length - 1];
      const isClosingPreviousDelimiter =
        lastDelimiter?.string === "`" && i > lastDelimiter.index;

      if (isClosingPreviousDelimiter) {
        stack.pop();
      } else {
        const characterAfterDelimiter = completedMarkdown[i + 1];
        if (characterAfterDelimiter && !WHITESPACE_REGEX.test(characterAfterDelimiter)) {
          stack.push({ string: "`", length: 1, index: i });
        }
      }
      continue;
    }

    if (character === "*" || character === "_" || character === "~") {
      const isInsideInlineCode = stack[stack.length - 1]?.string === "`";

      let j = i;
      while (j < completedMarkdown.length && completedMarkdown[j] === character) {
        j++;
      }
      const consecutiveDelimiterCharacters = j - i;

      if (isInsideInlineCode) {
        i += consecutiveDelimiterCharacters - 1;
        continue;
      }

      let remainingConsecutiveDelimiterCharacters = consecutiveDelimiterCharacters;
      let consecutiveDelimiterCharacterIndex = 0;

      while (remainingConsecutiveDelimiterCharacters > 0) {
        const lastDelimiter = stack[stack.length - 1];
        if (!lastDelimiter || lastDelimiter.string[0] !== character) break;

        if (remainingConsecutiveDelimiterCharacters >= lastDelimiter.length) {
          stack.pop();
          remainingConsecutiveDelimiterCharacters -= lastDelimiter.length;
          consecutiveDelimiterCharacterIndex += lastDelimiter.length;
          continue;
        }
        break;
      }

      if (remainingConsecutiveDelimiterCharacters > 0) {
        if (i + consecutiveDelimiterCharacters >= completedMarkdown.length) {
          completedMarkdown = completedMarkdown.slice(
            0,
            completedMarkdown.length - remainingConsecutiveDelimiterCharacters,
          );
          break;
        }

        const characterAfterDelimiters =
          completedMarkdown[i + consecutiveDelimiterCharacters];

        if (characterAfterDelimiters && !WHITESPACE_REGEX.test(characterAfterDelimiters)) {
          let delimiterStartIndex = i + consecutiveDelimiterCharacterIndex;

          if (remainingConsecutiveDelimiterCharacters % 2 === 1) {
            stack.push({
              string: character,
              length: 1,
              index: delimiterStartIndex,
            });
            delimiterStartIndex += 1;
            remainingConsecutiveDelimiterCharacters -= 1;
          }

          while (remainingConsecutiveDelimiterCharacters >= 2) {
            stack.push({
              string: character + character,
              length: 2,
              index: delimiterStartIndex,
            });
            delimiterStartIndex += 2;
            remainingConsecutiveDelimiterCharacters -= 2;
          }
        }
      }

      i += consecutiveDelimiterCharacters - 1;
      continue;
    }
  }

  if (allowLinksImages) {
    const partialLinkImageMatch = completedMarkdown.match(PARTIAL_LINK_IMAGE_REGEX);

    if (partialLinkImageMatch) {
      const linkImageStartIndex = partialLinkImageMatch.index!;
      const linkImageEndIndex = linkImageStartIndex + partialLinkImageMatch[0].length;

      const isInsideInlineCode = stack.some(
        (delimiter) =>
          delimiter.string === "`" && delimiter.index < linkImageStartIndex,
      );

      if (!isInsideInlineCode) {
        const partialLinkImageContent = partialLinkImageMatch[0];
        const {
          text: partialLinkText,
          url: partialLinkUrl,
          image: isImage,
        } = partialLinkImageMatch.groups!;

        if (isImage) {
          completedMarkdown = completedMarkdown.slice(0, -partialLinkImageContent.length);
        } else {
          for (let i = stack.length - 1; i >= 0; i--) {
            const delimiter = stack[i]!;
            if (
              delimiter.index >= linkImageStartIndex &&
              delimiter.index < linkImageEndIndex
            ) {
              stack.splice(i, 1);
            }
          }

          const completedLinkText = partialLinkText
            ? partialLinkUrl
              ? partialLinkText
              : completePartialInlineMarkdown(partialLinkText, {
                  allowLinksImages: false,
                })
            : "";
          const completedLinkUrl =
            partialLinkUrl &&
            !WHITESPACE_REGEX.test(partialLinkUrl) &&
            isUrl(partialLinkUrl)
              ? partialLinkUrl
              : DEFAULT_PARTIAL_LINK_URL;

          const completedLink = `[${completedLinkText}](${completedLinkUrl})`;
          completedMarkdown =
            completedMarkdown.slice(0, -partialLinkImageContent.length) + completedLink;
        }
      }
    }
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    const delimiter = stack[i]!;

    if (delimiter.index + delimiter.length >= completedMarkdown.length) {
      completedMarkdown = completedMarkdown.slice(0, delimiter.index);
      continue;
    }

    if (delimiter.string !== "`") {
      completedMarkdown = completedMarkdown.trimEnd();
    }

    completedMarkdown += delimiter.string;
  }

  return completedMarkdown;
}

/**
 * Build a complete table from a partial header line (e.g. "| a | b |") by
 * synthesizing the separator row underneath it. Returns `undefined` if the
 * input doesn't actually look like the start of a table.
 */
function completePartialTableMarkdown(markdown: string): string | undefined {
  const tableLines = markdown.split("\n");
  if (tableLines.length === 0) return undefined;

  const tableHeader = tableLines[0]!;
  if (tableHeader === "|") return undefined;

  const tableHeadings = tableHeader
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");

  if (tableHeadings.length === 0) return undefined;

  if (!tableHeader.endsWith("|")) {
    const lastTableHeading = tableHeadings[tableHeadings.length - 1]!;
    tableHeadings[tableHeadings.length - 1] =
      completePartialInlineMarkdown(lastTableHeading);
  }

  return `| ${tableHeadings.join(" | ")} |\n| ${tableHeadings.map(() => "---").join(" | ")} |`;
}

/**
 * Split the input into a "stable" prefix and a "trailing block" (everything
 * after the last blank line). Streaming completions only ever happen in the
 * trailing block, so the prefix can pass through untouched.
 */
function splitTrailingBlock(markdown: string): {
  prefix: string;
  trailing: string;
} {
  const lastBlankLine = markdown.lastIndexOf("\n\n");
  if (lastBlankLine === -1) {
    return { prefix: "", trailing: markdown };
  }
  return {
    prefix: markdown.slice(0, lastBlankLine + 2),
    trailing: markdown.slice(lastBlankLine + 2),
  };
}

/**
 * Replace a list item line that ends with a partial task checkbox (e.g.
 * "- [", "- [x") with a fully-formed checkbox so the parser commits to
 * "this is a task list" sooner. Operates on the trailing block only.
 */
function completePartialTaskListItem(block: string): string {
  const lines = block.split("\n");
  if (lines.length === 0) return block;

  const lastLineIndex = lines.length - 1;
  const lastLine = lines[lastLineIndex]!;

  const taskMatch = lastLine.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
  if (!taskMatch) return block;

  const [, marker, rest] = taskMatch;
  if (!marker || rest === undefined) return block;

  const checkboxMatch = rest.match(LIST_ITEM_CHECKBOX_REGEX);
  if (!checkboxMatch) return block;

  const checked = checkboxMatch[1] === "x" || checkboxMatch[1] === "X";
  lines[lastLineIndex] = `${marker}[${checked ? "x" : " "}] `;
  return lines.join("\n");
}

const FENCE_OPENER_REGEX = /^\s*(```|~~~)/;

/**
 * Inside fenced code blocks we must not touch the content at all. Returns
 * true if the cursor is currently inside an unterminated fence.
 */
function isInsideUnterminatedFence(markdown: string): boolean {
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (FENCE_OPENER_REGEX.test(line)) {
      inFence = !inFence;
    }
  }
  return inFence;
}

/**
 * Buffer a partial fence opener that lives on the very last line and has no
 * content after it yet. md4w would otherwise render it as an empty
 * <pre><code></code></pre> for one frame.
 */
function bufferLoneFenceOpener(markdown: string): string {
  const lines = markdown.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (!FENCE_OPENER_REGEX.test(lastLine)) return markdown;

  let fenceCount = 0;
  for (const line of lines) {
    if (FENCE_OPENER_REGEX.test(line)) fenceCount++;
  }

  if (fenceCount % 2 !== 1) return markdown;

  lines.pop();
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * Main entry point: preprocess a streaming Markdown chunk so a downstream
 * parser produces stable, complete output.
 */
export function preprocessPartialMarkdown(input: string): string {
  if (!input) return input;

  const normalized = normalizeNewlines(input);

  if (isInsideUnterminatedFence(normalized)) {
    const buffered = bufferLoneFenceOpener(normalized);
    if (buffered !== normalized) return buffered;
    return normalized;
  }

  const trimmed = trimPartialMarkdown(normalized);
  const { prefix, trailing } = splitTrailingBlock(trimmed);

  const taskCompleted = completePartialTaskListItem(trailing);
  const refDefinitionCompleted = completePartialReferenceDefinition(taskCompleted);
  const definitionBuffered = bufferInProgressReferenceDefinition(refDefinitionCompleted, prefix);
  const refBuffered = bufferPartialReferenceLink(definitionBuffered, normalized);
  const unresolvedRefsCompleted = completeUnresolvedReferenceLinks(refBuffered, normalized);

  if (PARTIAL_TABLE_HEADER_REGEX.test(unresolvedRefsCompleted)) {
    const completedTable = completePartialTableMarkdown(unresolvedRefsCompleted);
    if (completedTable) {
      return prefix + completedTable;
    }
  }

  const completedInline = completePartialInlineMarkdown(unresolvedRefsCompleted);
  const completedMarkdown = prefix + completedInline;
  return completeUnresolvedReferenceLinks(completedMarkdown, completedMarkdown);
}

function getLastLine(block: string): { lines: string[]; index: number; value: string } {
  const lines = block.split("\n");
  const index = lines.length - 1;
  return { lines, index, value: lines[index] ?? "" };
}

function bufferInProgressReferenceDefinition(block: string, prefix: string): string {
  const { lines, index, value } = getLastLine(block);
  const definitionStart = value.match(/^\s{0,3}\[(?<ref>[^\]\n]*)\]?:?\s*/);
  if (!definitionStart?.groups) return block;

  const ref = definitionStart.groups.ref.trim();
  if (!ref || !referencePrefixIsUsed(prefix, ref)) return block;
  if (REFERENCE_DEFINITION_REGEX.test(value)) return block;

  lines[index] = "";
  return lines.join("\n");
}

function completePartialReferenceDefinition(block: string): string {
  const { lines, index, value } = getLastLine(block);
  const match = value.match(REFERENCE_DEFINITION_REGEX);
  if (!match?.groups) return block;

  const rest = match.groups.rest ?? "";
  if (!rest.trim()) return block;

  const trimmedRest = rest.trimStart();
  const startsTitle = trimmedRest.startsWith('"') || trimmedRest.startsWith("'") || trimmedRest.startsWith("(");
  if (!startsTitle) return block;

  const opener = trimmedRest[0]!;
  const closer = opener === "(" ? ")" : opener;
  if (trimmedRest.length > 1 && trimmedRest.endsWith(closer)) return block;

  lines[index] = `${match.groups.prefix}${match.groups.url}`;
  return lines.join("\n");
}

/**
 * Buffer a trailing reference-style link expression ("[text][ref" or
 * "[text][ref]") while the reference id is incomplete, or while the input
 * doesn't yet contain a "[ref]: url" definition. Otherwise the link-image
 * completion step would treat the second bracket pair as a brand-new partial
 * link, leaving the first one as raw "[text]" text and turning the ref id
 * into a meaningless "#" link.
 */
function bufferPartialReferenceLink(block: string, fullInput: string): string {
  const match = block.match(PARTIAL_REFERENCE_LINK_REGEX);
  if (!match?.groups) return block;

  const ref = match.groups.ref.trim();
  const closed = match[0].endsWith("]");

  if (closed && ref && referenceIsDefined(fullInput, ref)) {
    return block;
  }

  const text = completePartialInlineMarkdown(match.groups.text, {
    allowLinksImages: false,
  });
  return `${block.slice(0, -match[0].length)}[${text}](${DEFAULT_PARTIAL_LINK_URL})`;
}

function completeUnresolvedReferenceLinks(block: string, fullInput: string): string {
  return block.replace(
    REFERENCE_LINK_REGEX,
    (match, image: string | undefined, text: string, ref: string) => {
      if (image || referenceIsDefined(fullInput, ref.trim())) return match;
      const completedText = completePartialInlineMarkdown(text, {
        allowLinksImages: false,
      });
      return `[${completedText}](${DEFAULT_PARTIAL_LINK_URL})`;
    },
  );
}

function referenceIsDefined(input: string, ref: string): boolean {
  const escaped = escapeRegExp(ref);
  const re = new RegExp(`(^|\\n)\\s{0,3}\\[${escaped}\\]:\\s`, "i");
  return re.test(input);
}

function referencePrefixIsUsed(input: string, refPrefix: string): boolean {
  const escaped = escapeRegExp(refPrefix);
  const re = new RegExp(`(?<!\\\\)\\[[^\\]\\n]+\\]\\[${escaped}[^\\]\\n]*\\]`, "i");
  return re.test(input);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const __internal = {
  normalizeNewlines,
  trimPartialMarkdown,
  completePartialInlineMarkdown,
  completePartialTableMarkdown,
  completePartialTaskListItem,
  splitTrailingBlock,
  isInsideUnterminatedFence,
  bufferLoneFenceOpener,
  bufferInProgressReferenceDefinition,
  completePartialReferenceDefinition,
  bufferPartialReferenceLink,
  completeUnresolvedReferenceLinks,
};
