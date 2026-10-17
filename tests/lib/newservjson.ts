// Parses newserv's JSON flavor (system/tables/*.json): // comments, hex
// integers (0x1F, -0x1) and trailing commas.
export function parseNewservJson(text: string): unknown {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (/[-0-9]/.test(c)) {
      const m = /^-?0x[0-9a-fA-F]+|^-?[0-9][0-9.eE+-]*/.exec(text.slice(i, i + 40))!;
      const tok = m[0];
      out += tok.includes('x') ? String(tok.startsWith('-') ? -parseInt(tok.slice(3), 16) : parseInt(tok.slice(2), 16)) : tok;
      i += tok.length;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
