import * as vscode from 'vscode';

/**
 * Originally adapted from https://github.com/TristanPerry/cypher-query-formatter/,
 * this is a crude, regex-based approach. A weak attempt is made to follow
 * the Cypher Style Guide: https://neo4j.com/developer/cypher-style-guide/.
 * TODO: Generate an AST and format based on that instead.
 */
const formatCypher = (query: string) => {
  const queryArrayTemp = query
    // remove whitespace (including newlines) between ON and CREATE/MATCH
    .replace(/\bON\s+(CREATE|MATCH)\b/gim, 'ON $1')
    // break up the file into an array of lines
    .split('\n')
    // remove leading and trailing whitespace from each line
    .map(line => line.trim());
  const queryArray: string[] = [];
  let level = 0;
  queryArrayTemp.forEach((line, i) => {
    if (line.startsWith('//')) {
      // If the line is only a comment then insert it as-is and bail
      queryArray.push(line.trimStart());
      return;
    }

    // Strip out line-ending comment and store for later
    let [, code = '', comment = ''] = (line.match(/^(.*?)(\/\/.*)?$/) ?? [
      null,
      '',
      '',
    ]) as [never, string, string];

    // Process this line if it either contains non-whitespace, or if the next line contains non-whitespace.
    if (code.length > 0 || (i > 0 && queryArrayTemp[i - 1].length > 0)) {
      let codeWithPlaceholders = code;
      const strings: Record<string, string> = {};
      let inStringOfType = '';
      let escapeNext = false;
      let innerStringTemp: string[] = [];
      const theStringTemp: string[] = [];
      for (const c of code.split('')) {
        if (!inStringOfType && (c === "'" || c === '"' || c === '`')) {
          // Start an inner string
          inStringOfType = c;
          innerStringTemp.push(c);
        } else if (!inStringOfType) {
          theStringTemp.push(c);
        } else if (inStringOfType && !escapeNext && c === '\\') {
          escapeNext = true;
          innerStringTemp.push(c);
        } else if (escapeNext) {
          escapeNext = false;
          innerStringTemp.push(c);
        } else if (c === inStringOfType) {
          // Close out the current inner string
          inStringOfType = '';
          innerStringTemp.push(c);
          const id = `##${Math.random()}##`;
          strings[id] = innerStringTemp.join('');
          theStringTemp.push(id);
          innerStringTemp = [];
        } else if (inStringOfType) {
          innerStringTemp.push(c);
        }
      }
      if (innerStringTemp.length === 0) {
        // length > 0 would mean mismatched quotes, in which case we'd
        // process the line with the quotes in place and hope for the best
        codeWithPlaceholders = theStringTemp.join('');
      }

      let newLineText =
        // Two spaces for each indentation level
        '  '.repeat(level) +
        codeWithPlaceholders
          // "Keywords, similar to clauses, should be styled in all capital letters and are not case-sensitive, but do not need to be placed on a separate line."
          .replace(
            /\b(WHEN|CASE|AND|OR|XOR|DISTINCT|AS|IN|STARTS\s+WITH|ENDS\s+WITH|CONTAINS|NOT|SET|ORDER\s+BY)\b/gi,
            match => ` ${match.toUpperCase().trim()} `
          )
          // "The null value and boolean literals should be written in lower case in a query."
          .replace(
            /\b(NULL|TRUE|FALSE)\b/gi,
            match => ` ${match.toLowerCase().trim()} `
          )
          // Now ensure that all 'main' Cypher keywords are on a new line
          .replace(
            /\b(CASE|DETACH\s+DELETE|DELETE|MATCH|MERGE|LIMIT|OPTIONAL\s+MATCH|RETURN|UNWIND|UNION|WHERE|WITH|GROUP\s+BY)\b/gi,
            (match, _p0, offset) =>
              `${offset > 0 ? '\n' : ''}${match
                .toUpperCase()
                .replace(/^\s+/, '')} `
          )
          // "One space after each comma in lists and enumerations."
          .replace(/,([^\s])/g, match => ', ' + match.replace(/,/g, ''))
          // "We can also make queries a bit easier to read by indenting ON CREATE or ON MATCH and any subqueries. Each of these blocks is indented with 2 spaces on a new line."
          .replace(/\bON\s*\nMATCH\b/gi, 'ON MATCH') // Fix previous 'MATCH' handling
          .replace(
            /\b(ON\s+CREATE|ON\s+MATCH)\b/gi,
            (match, _p0, offset) =>
              `${offset > 0 ? '\n' : ''}  ${match
                .toUpperCase()
                .replace(/^\s+/, '')} `
          )
          // "Use padding space within simple subquery expressions."
          .replace(/\{\s*(.*?)\s*\}/, '{ $1 }')
          // Replace multiple spaces with single space
          .replace(/ {2,}/g, ' ')
          .replace(/^ ON\b/, '  ON')
          // Remove whitespace before newlines that were added here
          .replace(/ +(\n)/g, '$1')
          // Trim trailing whitespace
          .trimEnd();

      for (const [id, str] of Object.entries(strings)) {
        newLineText = newLineText.replace(id, str);
      }

      queryArray.push(newLineText);
    }
    // Insert a newline after the end of each statement if necessary
    if (
      i < queryArrayTemp.length - 1 &&
      queryArrayTemp[i + 1].trim().length > 0 &&
      queryArray[queryArray.length - 1].endsWith(';')
    ) {
      queryArray.push('');
    }
    if (
      i < queryArrayTemp.length - 1 &&
      queryArray[queryArray.length - 1].endsWith('{')
    ) {
      level++;
    } else if (
      queryArray[queryArray.length - 1].endsWith('}') &&
      !queryArray[queryArray.length - 1].includes('{')
    ) {
      if (level > 0) {
        queryArray[queryArray.length - 1] =
          queryArray[queryArray.length - 1].substring(2);
      }
      level = Math.max(0, level - 1);
    }
    if (comment) {
      const arr = queryArray[queryArray.length - 1].split('\n');
      arr[0] = `${arr[0]} ${comment}`;
      queryArray[queryArray.length - 1] = arr.join('\n');
    }
  });
  query = queryArray.join('\n');

  // Proper block processing won't really be feasible until we're using an AST
  // query = query.replace(/ {([\S\s]*?)}/g, (match) => {
  //   let block = match
  //     .trim()
  //     .substring(1, match.trim().length - 1)
  //     .trim();
  //   return " {\n  " + block.replace(/(\r\n|\n|\r)/gm, "\n  ") + "\n}";
  // });

  return `${query.trim()}\n`;
};

class CypherDocumentFormatter implements vscode.DocumentFormattingEditProvider {
  public provideDocumentFormattingEdits(
    doc: vscode.TextDocument
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const firstPosition = doc.lineAt(0).range.start;
    const lastPosition = doc.lineAt(doc.lineCount - 1).range.end;
    const fullRange = doc.validateRange(
      new vscode.Range(firstPosition, lastPosition)
    );

    return [new vscode.TextEdit(fullRange, formatCypher(doc.getText().trim()))];
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      'cypher',
      new CypherDocumentFormatter()
    )
  );
}
