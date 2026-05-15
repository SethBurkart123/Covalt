# Markdown Stream Demo

A short paragraph with **bold**, *italic*, ***bold italic***, ~~strike~~, and `inline code`.

## Headings and emphasis

### Third level

#### Fourth level

A line with a [direct link](https://example.com "Example") and an autolink: https://example.com.

A line with an image ![alt text](https://example.com/img.png "Title").

## Lists

- First unordered item
- Second item with **bold**
- Third item with `code`

1. First ordered
2. Second ordered
3. Third ordered

- [x] Completed task
- [ ] Pending task
- [x] Another done one

## Blockquote

> A quote with *emphasis* and a [link](https://example.com).
>
> Second paragraph in the quote.

## Code blocks

Inline `let x = 1` here.

```js
function greet(name) {
  return `Hello, ${name}!`;
}
greet("world");
```

```python
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
```

## Table

| Name | Score | Note |
| ---- | ----- | ---- |
| Alice | 90 | Top |
| Bob | 75 | Mid |
| Carol | 60 | Low |

## Mixed inline

A sentence with **bold _and italic_** combined, plus ~~strike with `code` inside~~.

A trailing emoji sentence: hello world.

## Horizontal rule

---

## Reference-style links

Here's a direct [link to Anthropic](https://www.anthropic.com).

You can also use reference-style links like [this one][anthropic-ref] and even reuse the [same one][anthropic-ref] later.

[anthropic-ref]: https://www.anthropic.com "Anthropic Homepage"

End of demo.
