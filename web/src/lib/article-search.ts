type SearchToken =
  | { type: "term"; value: string }
  | { type: "and" | "or" | "left" | "right" };

export type SearchExpression =
  | { type: "term"; value: string }
  | { type: "and" | "or"; left: SearchExpression; right: SearchExpression };

function tokenize(input: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let index = 0;

  while (index < input.length) {
    if (/\s/.test(input[index])) {
      index += 1;
      continue;
    }

    if (input[index] === "(" || input[index] === ")") {
      tokens.push({ type: input[index] === "(" ? "left" : "right" });
      index += 1;
      continue;
    }

    if (input[index] === '"') {
      index += 1;
      let phrase = "";
      let closed = false;
      while (index < input.length) {
        const character = input[index];
        if (character === "\\" && index + 1 < input.length) {
          phrase += input[index + 1];
          index += 2;
        } else if (character === '"') {
          closed = true;
          index += 1;
          break;
        } else {
          phrase += character;
          index += 1;
        }
      }
      if (!closed) throw new Error("Unclosed quotation mark.");
      if (!phrase.trim()) throw new Error("Search phrases cannot be empty.");
      tokens.push({ type: "term", value: phrase });
      continue;
    }

    const start = index;
    while (index < input.length && !/[\s()]/.test(input[index])) index += 1;
    const value = input.slice(start, index);
    const operator = value.toLowerCase();
    if (operator === "and" || operator === "or") {
      tokens.push({ type: operator });
    } else {
      tokens.push({ type: "term", value });
    }
  }

  return tokens;
}

export function parseArticleSearch(input: string): SearchExpression {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Enter a search term.");
  let index = 0;

  function parsePrimary(): SearchExpression {
    const token = tokens[index];
    if (token?.type === "term") {
      index += 1;
      return { type: "term", value: token.value };
    }
    if (token?.type === "left") {
      index += 1;
      const expression = parseOr();
      if (tokens[index]?.type !== "right") {
        throw new Error("Missing closing parenthesis.");
      }
      index += 1;
      return expression;
    }
    throw new Error("Expected a search term or an opening parenthesis.");
  }

  function parseAnd(): SearchExpression {
    let expression = parsePrimary();
    while (tokens[index]?.type === "and") {
      index += 1;
      expression = { type: "and", left: expression, right: parsePrimary() };
    }
    return expression;
  }

  function parseOr(): SearchExpression {
    let expression = parseAnd();
    while (tokens[index]?.type === "or") {
      index += 1;
      expression = { type: "or", left: expression, right: parseAnd() };
    }
    return expression;
  }

  const expression = parseOr();
  if (index < tokens.length) {
    if (tokens[index].type === "right") throw new Error("Unexpected closing parenthesis.");
    if (tokens[index].type === "term") {
      throw new Error("Use AND or OR between search terms.");
    }
    throw new Error("Search expression is incomplete.");
  }
  return expression;
}
