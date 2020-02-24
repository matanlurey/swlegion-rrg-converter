#!/usr/bin/env node

import fs from 'fs-extra';
import pdfjs from 'pdfjs-dist';

(async () => {
  const buffer = await fs.readFile('./rrg/2020-02-28.pdf');
  const pdf = await pdfjs.getDocument(buffer).promise;

  const length = pdf.numPages;

  // Objective: We want to find the GLOSSARY items (ABILITIES, ACTIONS, ...)
  // and start creating a dictionary of all the GLOSSARY items, separating
  // keywords and non-keywords. This will allow creating a simple static HTML
  // website at a later point in time (for now we will emit JSON).
  let parsedGlossary = new Glossary();

  // Lazily parse. We could pre-parse everything, but that would be
  // unnecessary work (currently) and could tax lower-memory machines.
  //
  // Find only text items between GLOSSARY and ERRATA (as of 2020-02-28).
  let withinGlossary = false;

  // Parse the text content of every page, one page at a time. At least
  // currently we aren't concerned with any non-text content (images, etc).
  for (let i = 1; i <= length; i++) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    
    // TODO: Use page.getAnnotations().getOperatorList() to determine blue text.

    for (let item of text.items) {
      const text = new RRGTextItem(item);
      if (text.isBoldBlueTitle) {
        withinGlossary = text.content === 'GLOSSARY';
      } else if (withinGlossary) {
        parsedGlossary.addText(text);
      }
    }
  }

  parsedGlossary.complete();

  const raw = parsedGlossary.content;

  // Convert into JSON.
  const massaged = {};
  for (const key of Object.keys(raw)) {
    massaged[key] = (raw[key] || []).map((line) => {
      if (line === '* ' || line === '  * ') {
        return `\n${line}`;
      }
      return `${line} `;
    }).join('');
  }

  // Convert into markdown.
  const markdown: string[] = ['# Glossary\n'];
  for (const key of Object.keys(massaged)) {
    markdown.push(`\n## ${key}\n\n`);
    markdown.push(massaged[key]);
    markdown.push('\n');
  }

  console.log(markdown.join(''));
})();

/**
 * A wrapper around {pdfjs.TextContentItem} that understands FFG's conventions.
 */
class RRGTextItem {
  constructor(private readonly data: pdfjs.TextContentItem) {}

  /**
   * Returns whether this text is formatted big, blue, and bold.
   * 
   * E.g., this is how "GLOSSARY" is formatted in the RRG.
   */
  public get isBoldBlueTitle(): boolean {
    return this.data.fontName === 'g_d0_f1';
  }

  /**
   * Returns whether this text is formatted as large black title.
   * 
   * E.g., this is how "ABILITIES" is formatted in the RRG.
   */
  public get isBlackSubTitle(): boolean {
    return this.data.fontName === 'g_d0_f2' && this.data.height >= 18;
  }

  public get content(): string {
    return this.data.str;
  }
}

class Glossary {
  /**
   * Returns whether {charCode} is a standard Unicode character.
   *
   * https://unicode-table.com/en/#control-character
   *
   * @param charCode 
   */
  private static isStandardCharacter(charCode: number): boolean {
    return charCode >= 32 && charCode <= 126;
  }

  private static replaceUnicodeCharacters = {
    160: '',
    169: '©',
    186: 'º',
    187: '  * ',
    8211: '-',
    8212: '-',
    8220: '"',
    8221: '"',
    8226: '* ',
    8217: "'",
  };

  public readonly content: {[name: string]: string[]} = {};
  
  private contentBuilder: string[] = [];
  private titleBuilder: string[] = [];

  public addText(text: RRGTextItem): void {
    const content = this.normalizeString(text.content);
    if (content === '') {
      return;
    }
    if (text.isBlackSubTitle) {
      this.complete();
      this.titleBuilder.push(content);
    } else {
      this.contentBuilder.push(content);
    }
  }

  public complete(): void {
    if (this.isSectionCompletable) {
      const title = this.titleBuilder.join('');

      // TODO: Determine a better way of removing these incorrect titles.
      if (isNaN(parseInt(title))) {
        this.content[title] = this.contentBuilder;
      }
    }
    this.titleBuilder = [];
    this.contentBuilder = [];
  }

  private get isSectionCompletable(): boolean {
    return this.titleBuilder.length > 0 && this.contentBuilder.length > 0;
  }

  private normalizeString(input: string): string {
    if (input.length === 0) {
      return '\n';
    }
    input = input.trim();
    let output = '';
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (Glossary.isStandardCharacter(code)) {
        output += input.charAt(i);
      } else if (code >= 50000) {
        continue;
      } else {
        const replace = Glossary.replaceUnicodeCharacters[code];
        if (replace !== undefined) {
          output += replace;
        } else {
          // TODO: Find a better way of logging this.
          // console.warn('Unknown: <', code , '>', '"', input.charAt(i), '": ', input)
        }
      }
    }
    return output;
  }
}
